import type { Octokit } from "@octokit/rest";
import { log } from "../../../logger";
import type { RepoRef } from "../../event/model/types";
import type { InlineComment, ReviewComment } from "../model/types";

function postReview(
	octokit: Octokit,
	repo: RepoRef,
	number: number,
	commitSha: string,
	body: string,
	comments?: ReviewComment[],
) {
	return octokit.rest.pulls.createReview({
		...repo,
		pull_number: number,
		commit_id: commitSha,
		event: "COMMENT",
		body,
		...(comments ? { comments } : {}),
	});
}

export async function createReview(
	octokit: Octokit,
	repo: RepoRef,
	number: number,
	commitSha: string,
	body: string,
	comments: InlineComment[],
): Promise<{ posted: number; degraded: boolean }> {
	const payload: ReviewComment[] = comments.map((comment) => ({
		path: comment.path,
		line: comment.line,
		side: "RIGHT" as const,
		...(comment.startLine !== undefined && comment.startLine < comment.line
			? { start_line: comment.startLine, start_side: "RIGHT" as const }
			: {}),
		body: comment.body,
	}));

	try {
		await postReview(octokit, repo, number, commitSha, body, payload);
		return { posted: payload.length, degraded: false };
	} catch (error) {
		if (payload.length === 0) throw error;
		log.warn(
			`인라인 코멘트 등록 실패 — 요약 코멘트로 대체한다: ${(error as Error).message}`,
		);
		await postReview(octokit, repo, number, commitSha, body);
		return { posted: 0, degraded: true };
	}
}
