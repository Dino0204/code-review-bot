import type { PullRequestInfo } from "../../../github/client/model/types";
import { log } from "../../../logger";
import { renderThreadReply } from "../../render/lib/thread-reply";
import { loadExcerpt } from "./load-excerpt";
import { requestReply } from "./request-reply";
import type { ThreadDeps, ThreadOutcome } from "./types";

/**
 * 인라인 리뷰 쓰레드에서 봇을 부른 코멘트에 답한다.
 *
 * 리뷰와 달리 대상이 diff 전체가 아니라 쓰레드 한 곳이다 — 그 자리의 diff 조각,
 * 현재 파일 내용, 오간 대화만 실어 보낸다. 답은 같은 쓰레드에 답글로 달린다.
 */
export async function answerThread(
	deps: ThreadDeps,
	pr: PullRequestInfo,
	commentId: number,
): Promise<ThreadOutcome> {
	const { github, llm } = deps;

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

	const { reply, degraded } = await requestReply(deps, pr, thread, excerpt);
	await github.replyToReviewComment(
		pr.number,
		thread.rootId,
		renderThreadReply(reply.reply, reply.suggestion ?? undefined),
	);

	log.info(
		`#${pr.number} 쓰레드 응답 완료 (토큰 ${llm.totalUsage.total_tokens.toLocaleString()})`,
	);
	return { replied: true, degraded };
}
