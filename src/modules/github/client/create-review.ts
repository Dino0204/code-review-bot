import type { Octokit } from "@octokit/rest";
import type { RepoRef } from "@/core/event/model/types";
import type { InlineComment, ReviewComment } from "@/core/github/port";
import { log } from "@/core/ports/logger";

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
		await octokit.rest.pulls.createReview({
			...repo,
			pull_number: number,
			commit_id: commitSha,
			event: "COMMENT",
			body,
			comments: payload,
		});
		return { posted: payload.length, degraded: false };
	} catch (error) {
		// 여기서 요약을 대신 게시하지 않는다 — 부른 쪽이 이 지적들을 요약 코멘트에 모아 싣는다
		if (payload.length === 0) throw error;
		log.warn(`인라인 코멘트 등록 실패: ${(error as Error).message}`);
		return { posted: 0, degraded: true };
	}
}
