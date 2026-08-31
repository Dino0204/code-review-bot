import type { Octokit } from "@octokit/rest";
import type { RepoRef } from "@/core/event/model/types";
import type { Reaction, ReactionTarget } from "@/core/github/port";
import { log } from "@/core/ports/logger";

export async function addReaction(
	octokit: Octokit,
	repo: RepoRef,
	id: number,
	content: Reaction,
	target: ReactionTarget,
): Promise<void> {
	try {
		if (target === "review_comment") {
			await octokit.rest.reactions.createForPullRequestReviewComment({
				...repo,
				comment_id: id,
				content,
			});
		} else if (target === "issue") {
			await octokit.rest.reactions.createForIssue({
				...repo,
				issue_number: id,
				content,
			});
		} else {
			await octokit.rest.reactions.createForIssueComment({
				...repo,
				comment_id: id,
				content,
			});
		}
	} catch (error) {
		// 리뷰를 막을 이유는 아니지만 조용히 넘기지도 않는다 —
		// 리액션은 "봇이 봤다"는 유일한 즉시 신호라, 빠지면 사람이 같은 요청을 되풀이한다.
		log.warn(`리액션 등록 실패(${target} ${id}): ${(error as Error).message}`);
	}
}
