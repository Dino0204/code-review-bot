import type { Octokit } from "@octokit/rest";
import type { RepoRef } from "@/github/event/model/types";
import { log } from "@/logger";

export async function hasWriteAccess(
	octokit: Octokit,
	repo: RepoRef,
	username: string,
): Promise<boolean> {
	try {
		const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({
			...repo,
			username,
		});
		return ["admin", "write", "maintain"].includes(data.permission);
	} catch (error) {
		log.warn(
			`권한 확인 실패(${username}) — 트리거를 거부한다: ${(error as Error).message}`,
		);
		return false;
	}
}
