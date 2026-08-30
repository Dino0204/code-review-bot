import type { Octokit } from "@octokit/rest";
import type { RepoRef } from "../../event/model/types";
import type { PullRequestInfo } from "../model/types";

export async function getPullRequest(
	octokit: Octokit,
	repo: RepoRef,
	number: number,
): Promise<PullRequestInfo> {
	const { data } = await octokit.rest.pulls.get({
		...repo,
		pull_number: number,
	});
	return {
		number: data.number,
		title: data.title,
		body: data.body ?? "",
		author: data.user?.login ?? "unknown",
		baseRef: data.base.ref,
		headRef: data.head.ref,
		headSha: data.head.sha,
		baseSha: data.base.sha,
		draft: Boolean(data.draft),
		changedFiles: data.changed_files,
		additions: data.additions,
		deletions: data.deletions,
		htmlUrl: data.html_url,
		labels: data.labels
			.map((label) => (typeof label === "string" ? label : (label.name ?? "")))
			.filter(Boolean),
	};
}
