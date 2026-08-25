import { minimatch } from "minimatch";
import type { BotConfig } from "../config";
import { meetsSeverity } from "../config";
import type {
	GitHubClient,
	InlineComment,
	PullRequestInfo,
} from "../github/client";
import type { DiffFile } from "../github/diff";
import {
	parseUnifiedDiff,
	renderFileDiff,
	snapToCommentableLine,
} from "../github/diff";
import type { ChatMessage, LlmClient, ToolCall } from "../llm";
import { log } from "../logger";
import type { RepoInstructions, ReviewContext } from "./prompt";
import {
	buildReviewMessages,
	FINDING_TOOL,
	READ_TOOL,
	reviewTools,
	SUMMARY_TOOL,
} from "./prompt";
import {
	renderFindingComment,
	renderPlainComment,
	renderReviewSummary,
} from "./render";
import type { Finding, RawFinding, ReviewResult } from "./schema";
import { findingSchema } from "./schema";
import type { FileSource } from "./source";
import { buildFileSource, renderPlainSource, sourceLength } from "./source";

export interface RunnerDeps {
	github: GitHubClient;
	llm: LlmClient;
	config: BotConfig;
	/** 리포지토리 지침 문서. 없는 리포지토리도 있으므로 선택 사항이다 */
	instructions?: RepoInstructions;
}

interface GatheredContext {
	context: ReviewContext;
	skippedFiles: number;
}

/** PR diff를 받아 리뷰 대상 파일만 추린다 */
async function gatherContext(
	deps: RunnerDeps,
	pr: PullRequestInfo,
): Promise<GatheredContext> {
	const { github, config, instructions } = deps;

	const rawDiff = await github.getPullRequestDiff(pr.number);
	const allFiles = parseUnifiedDiff(rawDiff);
	const { selected, skipped } = filterFiles(allFiles, config);
	log.info(
		`diff 파일 ${allFiles.length}개 중 ${selected.length}개 리뷰 대상 (${skipped}개 제외)`,
	);

	const sources = config.includeSources
		? await loadSources(github, selected, pr.headSha, config)
		: [];

	return {
		context: { config, pr, diffFiles: selected, sources, instructions },
		skippedFiles: skipped,
	};
}

/**
 * 리뷰 대상 파일들의 현재 내용을 읽는다.
 *
 * 파일 하나를 못 읽는다고 리뷰를 멈추지 않는다 — 그 파일만 diff로 보게 되고,
 * 몇 개를 실었는지는 로그로 남겨 나중에 지적의 근거를 되짚을 수 있게 한다.
 */
async function loadSources(
	github: GitHubClient,
	files: DiffFile[],
	ref: string,
	config: BotConfig,
): Promise<FileSource[]> {
	const loaded = await Promise.all(
		files.map(async (file) => {
			try {
				const content = await github.readFile(file.path, ref);
				if (content === undefined) return undefined;
				return buildFileSource(file, content, config.maxSourceChars);
			} catch (error) {
				log.warn(
					`파일 원본 읽기 실패(무시): ${file.path} — ${error instanceof Error ? error.message : String(error)}`,
				);
				return undefined;
			}
		}),
	);

	const sources = loaded.filter(
		(source): source is FileSource => source !== undefined,
	);
	const partial = sources.filter((source) => source.partial).length;
	log.info(
		`파일 원본 ${sources.length}/${files.length}개 로드` +
			(partial ? ` (${partial}개는 발췌)` : ""),
	);
	return sources;
}

export function filterFiles(
	files: DiffFile[],
	config: BotConfig,
): { selected: DiffFile[]; skipped: number } {
	const matched = files.filter((file) => {
		if (file.isBinary) return false;
		if (file.status === "deleted") return false; // 삭제된 파일에는 코멘트를 달 수 없다
		if (
			config.include.length &&
			!config.include.some((pattern) =>
				minimatch(file.path, pattern, { dot: true }),
			)
		)
			return false;
		if (
			config.exclude.some((pattern) =>
				minimatch(file.path, pattern, { dot: true }),
			)
		)
			return false;
		return file.hunks.length > 0;
	});

	// 변경량이 큰 파일부터 — 예산이 모자라면 사소한 파일이 잘려나가게 한다
	const sorted = [...matched].sort(
		(a, b) => b.additions + b.deletions - (a.additions + a.deletions),
	);
	const selected = sorted.slice(0, config.maxFiles);
	return { selected, skipped: files.length - selected.length };
}

/**
 * diff가 프롬프트 예산을 넘으면 파일 단위로 쪼갠다.
 *
 * 지침 문서는 청크마다 다시 실리므로 그 길이를 청크 예산에서 미리 뺀다.
 * 다만 파일 하나는 언제나 담을 수 있어야 하므로 maxFileChars를 하한으로 둔다.
 */
export function chunkFiles(
	files: DiffFile[],
	config: BotConfig,
	instructionChars = 0,
	sourceSizes?: Map<string, number>,
): DiffFile[][] {
	const diffBudget = Math.max(
		Math.floor(config.maxPromptChars * 0.5) - instructionChars,
		config.maxFileChars,
	);
	const chunks: DiffFile[][] = [];
	let current: DiffFile[] = [];
	let size = 0;

	for (const file of files) {
		// 원본을 함께 싣는 설정이면 그 길이도 청크에 포함된다 — 빼놓으면 청크가 예산을 넘긴다
		const rendered =
			renderFileDiff(file, config.maxFileChars).length +
			(sourceSizes?.get(file.path) ?? 0);
		if (current.length > 0 && size + rendered > diffBudget) {
			chunks.push(current);
			current = [];
			size = 0;
		}
		current.push(file);
		size += rendered;
	}
	if (current.length) chunks.push(current);
	return chunks.length ? chunks : [[]];
}

export interface ReviewOutcome {
	posted: boolean;
	findings: number;
	inline: number;
}

export async function runReview(
	deps: RunnerDeps,
	pr: PullRequestInfo,
): Promise<ReviewOutcome> {
	const { github, llm, config } = deps;
	const { context, skippedFiles } = await gatherContext(deps, pr);

	if (context.diffFiles.length === 0) {
		await github.createIssueComment(
			pr.number,
			renderPlainComment(
				"🤖 코드 리뷰",
				"리뷰할 변경 사항이 없다. (제외 패턴에 걸렸거나 바이너리/삭제만 포함된 PR)",
				{
					model: llm.model,
				},
			),
		);
		return { posted: true, findings: 0, inline: 0 };
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
			model: llm.model,
			reviewedFiles: context.diffFiles.length,
			skippedFiles,
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
	};
}

/** 도구를 부르지 않은 응답을 몇 번까지 교정 요청할지 */
const MAX_NUDGES = 2;

/**
 * 모델에게 도구를 제시해 리뷰 결과를 받는다.
 *
 * 모델이 `read_file` 을 부르면 그 파일을 읽어 대화에 실어주고 다시 묻는다 —
 * diff에 없는 코드가 판단에 필요할 때 추측 대신 확인하게 하려는 것이다.
 * 리뷰 도구를 부른 시점에 대화가 끝나므로, 읽기 요청이 계속되면 상한에서 멈춘다.
 *
 * 도구 주입은 그래머 강제가 아니라 프롬프트 기반이므로 모델이 도구를 아예 안 부를 수 있다.
 * 그 경우 한 번 더 시도하고, 그래도 못 받으면 모델이 쓴 본문을 요약으로 대신 실어
 * 인라인 코멘트 없이도 리뷰가 통째로 사라지지 않게 한다.
 */
async function requestReview(
	deps: RunnerDeps,
	context: ReviewContext,
	config: BotConfig,
): Promise<ReviewResult> {
	const { llm, github } = deps;
	const tools = reviewTools(config);
	const options = {
		temperature: config.temperature,
		maxTokens: config.maxOutputTokens,
	};

	const conversation: ChatMessage[] = buildReviewMessages(context);
	// diff에 실린 파일은 이미 원본까지 넘겼으므로 다시 읽어줄 이유가 없다
	const served = new Set(context.diffFiles.map((file) => file.path));
	let reads = 0;
	let nudges = 0;
	let lastText = "";

	const maxRounds = MAX_NUDGES + config.maxExtraReads + 1;
	for (let round = 1; round <= maxRounds; round++) {
		const { toolCalls, text, raw } = await llm.chatWithTools(
			conversation,
			tools,
			options,
		);

		const readCalls = toolCalls.filter((call) => call.name === READ_TOOL);
		const reviewCalls = toolCalls.filter((call) => call.name !== READ_TOOL);

		// 리뷰를 제출했으면 그것으로 끝낸다. 읽기 요청을 함께 부른 경우 읽어주지 않는다 —
		// 이미 판단을 내려놓고 부른 것이라 한 번 더 물어도 같은 답이 돌아온다.
		if (reviewCalls.length > 0) {
			if (readCalls.length > 0) {
				log.warn(
					`리뷰 제출과 ${READ_TOOL} 을 함께 호출해 읽기 요청은 무시한다`,
				);
			}
			return collectToolCalls(reviewCalls);
		}

		if (readCalls.length > 0) {
			const { message, granted } = await serveReads(
				github,
				readCalls,
				context,
				config,
				served,
				reads,
			);
			reads += granted;
			conversation.push({ role: "assistant", content: raw });
			conversation.push({ role: "user", content: message });
			continue;
		}

		lastText = text;
		nudges++;
		log.warn(`모델이 도구를 호출하지 않았다 (${nudges}/${MAX_NUDGES})`);
		if (nudges >= MAX_NUDGES) break;

		// 재시도는 같은 프롬프트를 그대로 다시 보내는 대신 무엇이 잘못됐는지 알려준다.
		conversation.push({ role: "assistant", content: raw });
		conversation.push({ role: "user", content: retryNudge() });
	}

	return {
		summary: `_(모델이 도구를 호출하지 않아 본문을 그대로 싣는다 — 인라인 코멘트는 없다)_\n\n${lastText}`,
		findings: [],
	};
}

/**
 * 모델이 요청한 파일을 읽어 다음 차례에 실어줄 메시지를 만든다.
 *
 * 경로는 모델이 지어낸 문자열이므로 그대로 쓰지 않는다 — 리포지토리 밖을 가리키거나
 * 제외 대상인 경로는 거절하고, 거절한 이유도 함께 알려준다. 아무 말 없이 비워 보내면
 * 모델이 같은 파일을 계속 다시 요청한다.
 */
async function serveReads(
	github: GitHubClient,
	calls: ToolCall[],
	context: ReviewContext,
	config: BotConfig,
	served: Set<string>,
	used: number,
): Promise<{ message: string; granted: number }> {
	const parts: string[] = [];
	let granted = 0;

	for (const call of calls) {
		const requested = call.arguments["path"] ?? "";
		const path = normalizeReadPath(requested);

		if (!path) {
			parts.push(`\`${requested}\` — 경로를 해석할 수 없어 읽지 않았다.`);
			continue;
		}
		if (served.has(path)) {
			parts.push(`\`${path}\` — 이미 위에 실려 있다. 그 내용을 보라.`);
			continue;
		}
		if (used + granted >= config.maxExtraReads) {
			parts.push(
				`\`${path}\` — 읽기 상한(${config.maxExtraReads}개)에 도달해 읽지 않았다. 지금 있는 자료로 리뷰를 제출하라.`,
			);
			continue;
		}
		if (
			config.exclude.some((pattern) => minimatch(path, pattern, { dot: true }))
		) {
			parts.push(`\`${path}\` — 리뷰에서 제외된 경로라 읽지 않았다.`);
			continue;
		}

		let content: string | undefined;
		try {
			content = await github.readFile(path, context.pr.headSha);
		} catch (error) {
			log.warn(
				`${READ_TOOL} 실패: ${path} — ${error instanceof Error ? error.message : String(error)}`,
			);
			parts.push(`\`${path}\` — 읽는 중 오류가 나 내용을 가져오지 못했다.`);
			continue;
		}
		if (content === undefined) {
			parts.push(`\`${path}\` — 이 리포지토리에 없는 파일이다.`);
			continue;
		}

		served.add(path);
		granted++;
		log.info(`${READ_TOOL}: ${path} (${content.length}자)`);
		parts.push(renderPlainSource(path, content, config.maxSourceChars));
	}

	const remaining = config.maxExtraReads - (used + granted);
	const message = [
		`## ${READ_TOOL} 결과`,
		"",
		...parts,
		"",
		remaining > 0
			? `더 읽을 수 있는 파일은 ${remaining}개다. 필요 없으면 지금 리뷰를 제출하라.`
			: "읽기 상한에 도달했다. 지금 있는 자료로 리뷰를 제출하라.",
	].join("\n");

	return { message, granted };
}

/**
 * 모델이 준 경로를 리포지토리 안의 상대 경로로 정규화한다.
 *
 * 값을 검증 없이 API에 넘기면 모델이 지어낸 경로로 엉뚱한 요청을 보내게 된다.
 * 해석할 수 없으면 고쳐 쓰지 않고 undefined — 애매한 경로를 추측해 읽어주는 것보다
 * 읽지 못했다고 알리는 편이 낫다.
 */
export function normalizeReadPath(raw: string): string | undefined {
	const cleaned = raw
		.trim()
		.replace(/^['"`]|['"`]$/g, "")
		.replace(/^\/+/, "")
		.replace(/^\.\//, "")
		.replace(/^[ab]\//, "");

	if (!cleaned || cleaned.length > 400) return undefined;
	if (cleaned.includes("\0") || cleaned.includes("\n")) return undefined;
	// `..` 로 리포지토리 밖을 가리키는 경로는 거절한다
	if (cleaned.split("/").some((segment) => segment === "..")) return undefined;
	return cleaned;
}

/** 도구를 부르지 않은 응답에 붙이는 교정 지시. 형식은 도구 블록에 이미 있으므로 되풀이하지 않는다. */
function retryNudge(): string {
	return [
		"방금 응답에는 도구 호출이 없었다. 본문만 쓴 응답은 전달되지 않고 버려진다.",
		`같은 리뷰를 ${SUMMARY_TOOL} 호출 한 번과, 지적마다 ${FINDING_TOOL} 호출로 다시 제출하라.`,
		"<tool_call> 블록 밖에는 아무것도 쓰지 마라.",
	].join("\n");
}

/**
 * 도구 호출을 리뷰 결과로 모은다.
 *
 * 모델 출력은 신뢰하지 않는다 — 스키마에 맞지 않는 지적은 버리고 나머지는 살린다.
 * 하나가 어긋났다고 리뷰 전체를 잃는 것보다, 검증을 통과한 것만 게시하는 편이 낫다.
 */
function collectToolCalls(toolCalls: ToolCall[]): ReviewResult {
	const summaries: string[] = [];
	const findings: RawFinding[] = [];
	let malformed = 0;
	let unknown = 0;

	for (const call of toolCalls) {
		if (call.name === SUMMARY_TOOL) {
			const summary = call.arguments["summary"]?.trim();
			if (summary) summaries.push(summary);
			continue;
		}
		if (call.name !== FINDING_TOOL) {
			log.warn(`모델이 알 수 없는 도구를 호출했다: ${call.name}`);
			unknown++;
			continue;
		}

		const parsed = findingSchema.safeParse(call.arguments);
		if (parsed.success) {
			findings.push(parsed.data);
			continue;
		}
		malformed++;
		const issues = parsed.error.issues
			.slice(0, 3)
			.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
			.join("; ");
		log.warn(`지적 하나가 스키마와 맞지 않아 버렸다 — ${issues}`);
	}

	// 지적이 0건일 때 원인을 가릴 수 있어야 한다 —
	// 모델이 요약만 낸 것과, 낸 지적이 검증에서 떨어진 것은 서로 다른 문제다.
	log.info(
		`도구 호출 ${toolCalls.length}건 — 요약 ${summaries.length}, 지적 ${findings.length}` +
			(malformed ? `, 형식 오류 ${malformed}` : "") +
			(unknown ? `, 모르는 도구 ${unknown}` : ""),
	);

	return { summary: summaries.join("\n\n"), findings };
}

function mergeResults(results: ReviewResult[]): ReviewResult {
	if (results.length === 1) return results[0]!;

	return {
		summary: results
			.map((result) => result.summary.trim())
			.filter(Boolean)
			.join("\n\n"),
		findings: results.flatMap((result) => result.findings),
	};
}

/**
 * 모델이 뱉은 지적을 실제 게시 가능한 형태로 정제한다.
 * - 파일 경로를 diff에 존재하는 경로로 해석
 * - 줄 번호를 diff 안의 유효한 위치로 스냅
 * - 심각도 임계값 적용, 중복 제거, 개수 제한
 */
export function prepareFindings(
	result: ReviewResult,
	files: DiffFile[],
	config: BotConfig,
): { inline: Finding[]; overflow: Finding[] } {
	const severityOrder = { critical: 0, major: 1, minor: 2, nit: 3 };
	const seen = new Set<string>();
	const candidates: Finding[] = [];
	// 여기서 걸러진 지적은 인라인에도 요약에도 실리지 않는다 — 사라진 이유를 셈해 남긴다
	const dropped = { severity: 0, file: 0, duplicate: 0 };

	for (const raw of result.findings) {
		if (!meetsSeverity(raw.severity, config.minSeverity)) {
			dropped.severity++;
			continue;
		}

		const file = resolveFile(raw.file, files);
		if (!file) {
			log.debug(`diff에 없는 파일이라 버린다: ${raw.file}`);
			dropped.file++;
			continue;
		}

		// line === 0은 모델이 특정 줄을 짚지 못했다는 뜻(schema.ts 참고) — 스냅을 시도하지 않고 바로 요약행이다
		const hasLine = raw.line > 0;
		const line = hasLine ? snapToCommentableLine(file, raw.line) : undefined;
		const endLine = raw.end_line
			? snapToCommentableLine(file, raw.end_line)
			: undefined;

		const finding: Finding = {
			file: file.path,
			line: line ?? (hasLine ? raw.line : 1),
			endLine: endLine ?? undefined,
			severity: raw.severity,
			title: raw.title.trim(),
			detail: raw.detail.trim(),
			suggestion: raw.suggestion?.trim() || undefined,
			inlineDropped: line === undefined,
		};

		const key = dedupeKey(finding.file, finding.line, finding.title);
		if (seen.has(key)) {
			dropped.duplicate++;
			continue;
		}
		seen.add(key);
		candidates.push(finding);
	}

	candidates.sort(
		(a, b) => severityOrder[a.severity] - severityOrder[b.severity],
	);

	const inline: Finding[] = [];
	const overflow: Finding[] = [];
	for (const finding of candidates) {
		if (finding.inlineDropped || inline.length >= config.maxInlineComments)
			overflow.push(finding);
		else inline.push(finding);
	}

	if (result.findings.length > 0) {
		const total = dropped.severity + dropped.file + dropped.duplicate;
		log.info(
			`지적 ${result.findings.length}건 → 인라인 ${inline.length}, 요약 ${overflow.length}` +
				(total
					? ` (제외 ${total} — 심각도 ${dropped.severity}, 경로 ${dropped.file}, 중복 ${dropped.duplicate})`
					: ""),
		);
	}

	return { inline, overflow };
}

/** 모델이 `a/src/x.ts`, `./src/x.ts`, `x.ts` 등으로 흘려 쓴 경로를 diff의 실제 경로에 맞춘다 */
export function resolveFile(
	raw: string,
	files: DiffFile[],
): DiffFile | undefined {
	const cleaned = raw
		.trim()
		.replace(/^\.\//, "")
		.replace(/^[ab]\//, "");
	const exact = files.find((file) => file.path === cleaned);
	if (exact) return exact;

	const suffix = files.filter((file) => file.path.endsWith(`/${cleaned}`));
	if (suffix.length === 1) return suffix[0];

	const base = cleaned.split("/").pop();
	if (!base) return undefined;
	const byBasename = files.filter(
		(file) => file.path.endsWith(`/${base}`) || file.path === base,
	);
	return byBasename.length === 1 ? byBasename[0] : undefined;
}

/** 같은 지적인지 판단하는 키. 제목의 앞부분만 써서 문구가 조금 달라져도 중복으로 잡는다. */
export function dedupeKey(path: string, line: number, title: string): string {
	const normalized = title
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/[*_`#]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase()
		.slice(0, 60);
	return `${path}:${line}:${normalized}`;
}
