import type { BotConfig } from "@/core/config/model/bot-config";
import type { InlineComment, PullRequestInfo } from "@/core/github/port";
import { log } from "@/core/ports/logger";
import type { ReviewContext } from "@/core/review/prompt/model/types";
import { INLINE_REVIEW_BODY } from "@/core/review/render/consts/marker";
import { renderFindingComment } from "@/core/review/render/lib/finding-comment";
import { renderPlainComment } from "@/core/review/render/lib/plain-comment";
import { renderReviewSummary } from "@/core/review/render/lib/review-summary";
import type { Finding } from "@/core/review/schema/model/finding";
import type { ReviewResult } from "@/core/review/schema/model/review-result";
import { sourceLength } from "@/core/review/source/lib/render-file-source";
import { chunkFiles } from "../lib/chunk-files";
import { mergeResults } from "../lib/merge-results";
import { dedupeKey, prepareFindings } from "../lib/prepare-findings";
import { gatherContext } from "./gather-context";
import { requestReview } from "./request-review";
import type { ReviewOutcome, RunnerDeps } from "./types";
import { upsertSummary } from "./upsert-summary";

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
			return {
				posted: false,
				findings: 0,
				inline: 0,
				markers: hashes,
				failedFiles: [],
				postedKeys: [],
			};
		}
		await github.createIssueComment(
			pr.number,
			renderPlainComment(
				"🤖 코드 리뷰",
				"리뷰할 변경 사항이 없다. (제외 패턴에 걸렸거나 바이너리/삭제만 포함된 PR)",
			),
		);
		return {
			posted: true,
			findings: 0,
			inline: 0,
			markers: hashes,
			failedFiles: [],
			postedKeys: [],
		};
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
	const reviewed = new Set<string>();
	const failed: string[] = [];
	let firstError: unknown;

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
		try {
			results.push(await requestReview(deps, chunkContext, config));
			for (const path of paths) reviewed.add(path);
		} catch (error) {
			// 청크 하나가 실패해도 나머지는 게시한다 — 다 가진 뒤에 올리려다 아무것도 못 올리는
			// 것보다, 받은 만큼 올리고 못 본 파일을 마커에 안 남기는 편이 낫다
			firstError ??= error;
			failed.push(...paths);
			log.error(
				`청크 ${index + 1}/${chunks.length} 실패 — ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// 하나도 못 받았으면 게시할 것이 없다. 그대로 던져 재시도에 맡긴다.
	if (results.length === 0) throw firstError ?? new Error("리뷰 결과가 없다");

	const merged = mergeResults(results);
	const { inline, overflow } = prepareFindings(
		merged,
		context.diffFiles,
		config,
	);

	// 이미 단 지적은 다시 달지 않는다 — 재시도나 재리뷰에서 같은 코멘트가 겹쳐 쌓이는 것을 막는다
	const posted0 = deps.postedKeys ?? new Set<string>();
	const keyOf = (finding: Finding): string =>
		dedupeKey(finding.file, finding.line, finding.title);
	const fresh = inline.filter((finding) => !posted0.has(keyOf(finding)));
	const repeated = inline.length - fresh.length;
	if (repeated) log.info(`이미 달린 지적 ${repeated}건은 다시 달지 않는다`);

	// GitHub 멀티라인 코멘트는 `line`이 끝 줄, `start_line`이 시작 줄이다
	const comments: InlineComment[] = fresh.map((finding) => {
		const hasRange =
			finding.endLine !== undefined && finding.endLine > finding.line;
		return {
			path: finding.file,
			line: hasRange ? finding.endLine! : finding.line,
			startLine: hasRange ? finding.line : undefined,
			body: renderFindingComment(finding),
		};
	});

	// 인라인을 먼저 보낸다 — 등록에 실패한 지적을 요약에 실어야 통째로 사라지지 않는다
	const { posted, degraded } = comments.length
		? await github.createReview(
				pr.number,
				pr.headSha,
				INLINE_REVIEW_BODY,
				comments,
			)
		: { posted: 0, degraded: false };
	if (degraded) {
		log.warn("인라인 코멘트가 등록되지 않아 요약에 모아 싣는다");
	}

	const body = renderReviewSummary(
		merged,
		degraded ? [] : inline,
		degraded ? [...overflow, ...inline] : overflow,
		{
			reviewedFiles: reviewed.size,
			skippedFiles,
			unchangedFiles,
			failedFiles: failed,
			repeatedFindings: repeated,
			promptTokens: llm.totalUsage.prompt_tokens,
			completionTokens: llm.totalUsage.completion_tokens,
			chunks: chunks.length,
		},
		config,
	);

	const summaryCommentId = await upsertSummary(
		github,
		pr.number,
		body,
		deps.summaryCommentId,
	);

	return {
		posted: true,
		findings: inline.length + overflow.length,
		inline: posted,
		// 실패한 청크의 파일은 마커에 안 남긴다 — 다음 시도에서 그 파일만 다시 묶인다
		markers: new Map([...hashes].filter(([path]) => reviewed.has(path))),
		summaryCommentId,
		failedFiles: failed,
		// 등록에 실패한 인라인은 "달았다"고 적지 않는다
		postedKeys: degraded ? [] : fresh.map(keyOf),
	};
}
