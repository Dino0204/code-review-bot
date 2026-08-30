import type { Octokit } from "@octokit/rest";
import type { RepoRef } from "@/github/event/model/types";

export async function getPullRequestDiff(
	octokit: Octokit,
	repo: RepoRef,
	number: number,
): Promise<string> {
	const response = await octokit.rest.pulls.get({
		...repo,
		pull_number: number,
		mediaType: { format: "diff" },
	});
	return response.data as unknown as string;
}
