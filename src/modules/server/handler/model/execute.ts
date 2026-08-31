import { isTrustedAssociation } from "@/core/event/lib/actor";
import type { Trigger } from "@/core/event/model/types";
import type { GitHubClient } from "@/core/github/port";
import { log } from "@/core/ports/logger";
import { renderError } from "@/core/review/render/lib/error";
import { runReview } from "@/core/review/runner/model/run-review";
import type { RunnerDeps } from "@/core/review/runner/model/types";
import { answerThread } from "@/core/review/thread/model/answer-thread";
import { createGitHubClient } from "@/modules/github/client/create-github-client";
import { createLlmClient } from "@/modules/llm/client";
import { loadRepoConfig } from "../api/load-repo-config";
import { loadRepoInstructions } from "../api/load-repo-instructions";
import { resolveIntent } from "../lib/resolve-intent";
import type { HandlerDeps, Intent } from "./types";

/** 실패를 알린다. 쓰레드에서 부른 것이면 그 쓰레드에, 아니면 PR 코멘트로 남긴다. */
async function reportFailure(
	github: GitHubClient,
	trigger: Trigger,
	intent: Intent,
	message: string,
): Promise<void> {
	if (intent.kind === "reply") {
		await github.replyToReviewComment(
			trigger.pr,
			intent.commentId,
			renderError(message, "답변 실패"),
		);
		return;
	}
	await github.createIssueComment(trigger.pr, renderError(message));
}

export async function execute(
	deps: HandlerDeps,
	owner: string,
	repo: string,
	installationId: number,
	trigger: Trigger,
): Promise<void> {
	const slug = `${owner}/${repo}`;
	const prRef = { owner, repo, pr: trigger.pr };
	const token = await deps.app.installationToken(installationId);
	const github = createGitHubClient(token, { owner, repo });

	// 사람이 명시적으로 트리거한 경우에만 권한을 확인한다.
	// 리뷰를 시작하기 전에 한다 — 권한 없는 요청에 API 쿼터를 쓸 이유가 없다.
	const byComment =
		trigger.kind === "issue_comment" || trigger.kind === "review_comment";
	if (byComment) {
		const trusted =
			isTrustedAssociation(trigger.association) ||
			(await github.hasWriteAccess(trigger.author));
		if (!trusted) {
			log.warn(
				`${slug}: ${trigger.author}(${trigger.association})에게 쓰기 권한이 없어 명령을 무시한다`,
			);
			return;
		}
	}

	const pr = await github.getPullRequest(trigger.pr);
	const config = await loadRepoConfig(github, pr.headSha, deps.repoOverrides);

	const intent = resolveIntent(trigger, config);
	if (!intent) {
		log.debug(`${slug}#${trigger.pr}: 봇을 부른 이벤트가 아니다`);
		return;
	}

	// 봇이 이벤트를 붙잡았다는 것을 사람이 볼 수 있게 남긴다.
	// 큐가 밀리면 리뷰가 끝나기까지 수십 분이 걸리는데, 그때까지 아무 표시가 없으면
	// 무시당한 줄 알고 같은 요청을 되풀이하게 된다.
	if (byComment) {
		const target =
			trigger.kind === "review_comment" ? "review_comment" : "issue_comment";
		await github.addReaction(trigger.commentId, "eyes", target);
	} else {
		// 자동 리뷰에는 사람이 부른 코멘트가 없다 — PR 본문에 단다
		await github.addReaction(trigger.pr, "eyes", "issue");
	}

	// 할 일을 정한 뒤에 읽는다 — 무시할 이벤트에 API 쿼터를 쓰지 않는다
	const instructions = await loadRepoInstructions(github, pr.headSha);

	const llm = createLlmClient({
		apiKey: deps.gsmlApiKey,
		baseUrl: config.baseUrl,
	});

	try {
		if (intent.kind === "reply") {
			log.info(
				`${slug}#${pr.number} 쓰레드 응답 시작 (코멘트 ${intent.commentId})`,
			);
			const outcome = await answerThread(
				{ github, llm, config, instructions },
				pr,
				intent.commentId,
			);
			if (outcome.degraded)
				log.warn("도구 호출을 받지 못해 모델 본문을 그대로 실었다");
			return;
		}

		log.info(`${slug}#${pr.number} "${pr.title}" 리뷰 시작`);
		// 사람이 부른 리뷰는 처음부터 다시 본다 — 같은 코드를 한 번 더 봐달라는 뜻이다.
		// 자동 리뷰(푸시·오픈)만 마커를 보고 달라진 파일로 좁힌다.
		const markers =
			trigger.kind === "pull_request"
				? await deps.state.markers(prRef)
				: undefined;
		const runnerDeps: RunnerDeps = {
			github,
			llm,
			config,
			instructions,
			markers,
			// 요약은 사람이 부른 리뷰에서도 같은 자리를 고쳐 쓴다 — PR 마다 요약은 하나다
			summaryCommentId: await deps.state.summaryCommentId(prRef),
		};
		const outcome = await runReview(runnerDeps, pr);
		// 게시까지 끝난 뒤에 남긴다 — 게시에 실패한 파일을 "봤다"고 적으면 영영 안 보게 된다
		await deps.state.saveMarkers(prRef, outcome.markers);
		if (outcome.summaryCommentId !== undefined)
			await deps.state.setSummaryCommentId(prRef, outcome.summaryCommentId);
		log.info(`${slug}#${pr.number} 리뷰 완료 — 지적 ${outcome.findings}건`);
	} catch (error) {
		// 실패 사실을 사람이 부른 자리에서 바로 볼 수 있게 남긴다
		const message = error instanceof Error ? error.message : String(error);
		log.error(`${slug}#${pr.number} 실패: ${message}`);
		await reportFailure(github, trigger, intent, message).catch(
			(commentError: unknown) =>
				log.warn(`실패 코멘트 등록 실패: ${String(commentError)}`),
		);
		throw error;
	}
}
