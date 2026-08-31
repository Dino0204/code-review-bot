import type { Octokit } from "@octokit/rest";
import type { RepoRef } from "@/github/event/model/types";
import type { ReviewThread } from "../model/types";

/**
 * 쓰레드는 GitHub API에 통째로 가져오는 엔드포인트가 없다.
 * PR의 리뷰 코멘트를 모두 읽어 `in_reply_to_id` 로 묶는다 —
 * 답글은 모두 쓰레드의 뿌리를 가리키므로 뿌리 id 하나로 갈라진다.
 */
export async function getReviewThread(
	octokit: Octokit,
	repo: RepoRef,
	number: number,
	commentId: number,
): Promise<ReviewThread | undefined> {
	const comments = await octokit.paginate(
		octokit.rest.pulls.listReviewComments,
		{
			...repo,
			pull_number: number,
			per_page: 100,
		},
	);

	const target = comments.find((comment) => comment.id === commentId);
	if (!target) return undefined;

	const rootId = target.in_reply_to_id ?? target.id;
	const thread = comments
		.filter((comment) => (comment.in_reply_to_id ?? comment.id) === rootId)
		.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);

	// line이 비면 그 자리가 최신 diff에서 밀려났다는 뜻이다 — 위치는 original_line으로 되짚는다
	const root = thread[0] ?? target;
	return {
		rootId,
		path: root.path,
		line: root.line ?? root.original_line ?? undefined,
		outdated: root.line === null || root.line === undefined,
		diffHunk: root.diff_hunk ?? "",
		comments: thread.map((comment) => ({
			id: comment.id,
			author: comment.user?.login ?? "unknown",
			body: comment.body ?? "",
			createdAt: comment.created_at,
			isBot: comment.user?.type === "Bot",
		})),
	};
}
