import { RequestError } from "@octokit/request-error";
import type { Octokit } from "@octokit/rest";
import type { RepoRef } from "@/core/event/model/types";
import { log } from "@/core/ports/logger";

/**
 * 이미 단 코멘트를 고쳐 쓴다. 사람이 지웠으면 `false`.
 *
 * 404 만 없어진 것으로 본다 — 권한 문제(403)나 서버 오류를 "지워졌다"로 삼키면
 * 코멘트가 멀쩡히 살아 있는데 하나 더 달게 된다.
 */
export async function updateIssueComment(
	octokit: Octokit,
	repo: RepoRef,
	commentId: number,
	body: string,
): Promise<boolean> {
	try {
		await octokit.rest.issues.updateComment({
			...repo,
			comment_id: commentId,
			body,
		});
		return true;
	} catch (error) {
		if (error instanceof RequestError && error.status === 404) {
			log.info(`요약 코멘트 ${commentId} 가 사라졌다 — 새로 단다`);
			return false;
		}
		throw error;
	}
}
