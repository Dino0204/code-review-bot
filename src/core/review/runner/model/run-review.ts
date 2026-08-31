import type { BotConfig } from "@/core/config/model/bot-config";
import type { InlineComment, PullRequestInfo } from "@/core/github/port";
import { log } from "@/core/ports/logger";
import type { ReviewContext } from "@/core/review/prompt/model/types";
import { renderFindingComment } from "@/core/review/render/lib/finding-comment";
import { renderPlainComment } from "@/core/review/render/lib/plain-comment";
import { renderReviewSummary } from "@/core/review/render/lib/review-summary";
import type { ReviewResult } from "@/core/review/schema/model/review-result";
import { sourceLength } from "@/core/review/source/lib/render-file-source";
import { chunkFiles } from "../lib/chunk-files";
import { mergeResults } from "../lib/merge-results";
import { prepareFindings } from "../lib/prepare-findings";
import { gatherContext } from "./gather-context";
import { requestReview } from "./request-review";
import type { ReviewOutcome, RunnerDeps } from "./types";

export async function runReview(
	deps: RunnerDeps,
	pr: PullRequestInfo,
): Promise<ReviewOutcome> {
	const { github, llm, config } = deps;
	const { context, skippedFiles, unchangedFiles, hashes } = await gatherContext(
		deps,
		pr,
	);

	if (context.diffFiles.length === 0) {
		// 증분에서 걸러져 볼 것이 없는 경우다 — 이미 단 코멘트가 그대로 유효하므로
		// "변경 없음" 을 새로 게시하지 않는다. 푸시마다 코멘트가 쌓이면 그게 소음이다.
		if (unchangedFiles > 0) {
			log.info("이미 리뷰한 내용 그대로라 새로 게시하지 않는다");
			return { posted: false, findings: 0, inline: 0, markers: hashes };
		}
		await github.createIssueComment(
			pr.number,
			renderPlainComment(
				"🤖 코드 리뷰",
				"리뷰할 변경 사항이 없다. (제외 패턴에 걸렸거나 바이너리/삭제만 포함된 PR)",
			),
		);
		return { posted: true, findings: 0, inline: 0, markers: hashes };
	}

	const sources = context.sources ?? [];
	const sourceSizes = new Map(
		sources.map((source) => [source.path, sourceLength(source)]),
	);
	const chunks = chunkFiles(
		context.diffFiles,
		config,
		context.instructions?.content.length ?? 0,
		sourceSizes,
	);
	log.info(`리뷰 청크 ${chunks.length}개`);

	const results: ReviewResult[] = [];
	for (const [index, chunk] of chunks.entries()) {
		if (chunks.length > 1)
			log.info(
				`청크 ${index + 1}/${chunks.length} 리뷰 중 (${chunk.length}개 파일)`,
			);
		const paths = new Set(chunk.map((file) => file.path));
		const chunkContext: ReviewContext = {
			...context,
			diffFiles: chunk,
			sources: sources.filter((source) => paths.has(source.path)),
		};
		results.push(await requestReview(deps, chunkContext, config));
	}

	const merged = mergeResults(results);
	const { inline, overflow } = prepareFindings(
		merged,
		context.diffFiles,
		config,
	);

	// GitHub 멀티라인 코멘트는 `line`이 끝 줄, `start_line`이 시작 줄이다
	const comments: InlineComment[] = inline.map((finding) => {
		const hasRange =
			finding.endLine !== undefined && finding.endLine > finding.line;
		return {
			path: finding.file,
			line: hasRange ? finding.endLine! : finding.line,
			startLine: hasRange ? finding.line : undefined,
			body: renderFindingComment(finding),
		};
	});

	const body = renderReviewSummary(
		merged,
		inline,
		overflow,
		{
			reviewedFiles: context.diffFiles.length,
			skippedFiles,
			unchangedFiles,
			promptTokens: llm.totalUsage.prompt_tokens,
			completionTokens: llm.totalUsage.completion_tokens,
			chunks: chunks.length,
		},
		config,
	);

	const { posted, degraded } = await github.createReview(
		pr.number,
		pr.headSha,
		body,
		comments,
	);
	if (degraded) {
		log.warn("인라인 코멘트가 등록되지 않아 요약만 게시했다");
	}

	return {
		posted: true,
		findings: inline.length + overflow.length,
		inline: posted,
		markers: hashes,
	};
}
