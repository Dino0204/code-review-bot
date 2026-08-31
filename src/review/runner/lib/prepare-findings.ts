import { meetsSeverity } from "@/config/lib/severity-rank";
import type { BotConfig } from "@/config/model/bot-config";
import { snapToCommentableLine } from "@/github/diff/lib/snap-to-commentable-line";
import type { DiffFile } from "@/github/diff/model/types";
import { log } from "@/logger";
import type { Finding } from "@/review/schema/model/finding";
import type { ReviewResult } from "@/review/schema/model/review-result";

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
