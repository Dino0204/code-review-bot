import type { Octokit } from "@octokit/rest";
import type { RepoRef } from "@/github/event/model/types";

export async function readFile(
	octokit: Octokit,
	repo: RepoRef,
	path: string,
	ref: string,
): Promise<string | undefined> {
	try {
		const { data } = await octokit.rest.repos.getContent({
			...repo,
			path,
			ref,
			mediaType: { format: "raw" },
		});
		return data as unknown as string;
	} catch (error) {
		if ((error as { status?: number }).status === 404) return undefined;
		throw error;
	}
}
