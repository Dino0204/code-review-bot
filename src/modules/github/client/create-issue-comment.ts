import type { Octokit } from "@octokit/rest";
import type { RepoRef } from "@/core/event/model/types";

export async function createIssueComment(
	octokit: Octokit,
	repo: RepoRef,
	number: number,
	body: string,
): Promise<number> {
	const { data } = await octokit.rest.issues.createComment({
		...repo,
		issue_number: number,
		body,
	});
	return data.id;
}
