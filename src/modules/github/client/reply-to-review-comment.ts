import type { Octokit } from "@octokit/rest";
import type { RepoRef } from "@/core/event/model/types";

export async function replyToReviewComment(
	octokit: Octokit,
	repo: RepoRef,
	number: number,
	commentId: number,
	body: string,
): Promise<number> {
	const { data } = await octokit.rest.pulls.createReplyForReviewComment({
		...repo,
		pull_number: number,
		comment_id: commentId,
		body,
	});
	return data.id;
}
