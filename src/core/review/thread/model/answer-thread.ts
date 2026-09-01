import type { PullRequestInfo } from "@/core/github/port";
import { log } from "@/core/ports/logger";
import { buildReplyMessages } from "@/core/review/prompt/model/reply-messages";
import { renderThreadReply } from "@/core/review/render/lib/thread-reply";
import { loadExcerpt } from "./load-excerpt";
import { requestReply } from "./request-reply";
import type { ThreadDeps, ThreadOutcome } from "./types";

/**
 * 인라인 리뷰 쓰레드에서 봇을 부른 코멘트에 답한다.
 *
 * 리뷰와 달리 대상이 diff 전체가 아니라 쓰레드 한 곳이다 — 그 자리의 diff 조각,
 * 현재 파일 내용, 오간 대화만 실어 보낸다. 답은 같은 쓰레드에 답글로 달린다.
 *
 * 답변은 배치가 하나뿐인 리뷰와 같다 — 체인이 provider 를 고르고, 실패하면 다음
 * provider 가 같은 프롬프트를 받는다. 쪼갤 배치가 없으므로 예산을 넘기면 그대로 실패한다.
 */
export async function answerThread(
	deps: ThreadDeps,
	pr: PullRequestInfo,
	commentId: number,
): Promise<ThreadOutcome> {
	const { github, chain, config, instructions } = deps;

	const thread = await github.getReviewThread(pr.number, commentId);
	if (!thread) {
		// 코멘트가 지워졌거나 이 PR의 것이 아니다. 답글을 달 자리가 없으니 조용히 끝낸다.
		log.warn(`#${pr.number}: 코멘트 ${commentId}가 속한 쓰레드를 찾지 못했다`);
		return { replied: false, degraded: false };
	}

	const excerpt = await loadExcerpt(github, thread, pr.headSha);
	log.info(
		`#${pr.number} 쓰레드 응답 — ${thread.path}${thread.line ? `:${thread.line}` : ""}, 코멘트 ${thread.comments.length}건` +
			`${excerpt ? "" : " (파일 발췌 없음)"}`,
	);

	const messages = buildReplyMessages({
		config,
		pr,
		thread,
		excerpt,
		instructions,
	});
	const promptChars = messages.reduce(
		(sum, message) => sum + message.content.length,
		0,
	);

	const { reply, degraded } = await chain.run(promptChars, (llm, spec) => {
		log.info(`쓰레드 답변을 ${spec.name} 에 맡긴다`, {
			provider: spec.name,
			model: spec.model,
		});
		return requestReply({ llm, config }, messages);
	});

	await github.replyToReviewComment(
		pr.number,
		thread.rootId,
		renderThreadReply(reply.reply, reply.suggestion ?? undefined),
	);

	log.info(
		`#${pr.number} 쓰레드 응답 완료 (토큰 ${chain.totalUsage.total_tokens.toLocaleString()})`,
	);
	return { replied: true, degraded };
}
