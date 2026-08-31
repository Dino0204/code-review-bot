import type { FileSource, SourceRegion } from "../model/types";

/** `줄번호 | 코드` — 모델이 diff의 줄 번호와 대조할 수 있게 맞춘다 */
function renderRegion(region: SourceRegion): string {
	const width = String(region.startLine + region.lines.length - 1).length;
	return region.lines
		.map(
			(line, index) =>
				`${String(region.startLine + index).padStart(width, " ")} | ${line}`,
		)
		.join("\n");
}

export function renderFileSource(source: FileSource): string {
	const scope = source.partial
		? `전체 ${source.totalLines}줄 중 변경 구간 주변만 발췌`
		: `전체 ${source.totalLines}줄`;
	const header = `### ${source.path} (${scope})`;

	if (source.regions.length === 0) return `${header}\n(내용을 읽지 못했다)`;

	const body = source.regions
		.map((region) => renderRegion(region))
		.join("\n\n… (중략) …\n\n");

	return `${header}\n\`\`\`\n${body}\n\`\`\``;
}

/** 이 파일 원본이 프롬프트에서 차지할 길이 — 청크 예산 계산에 쓴다 */
export function sourceLength(source: FileSource): number {
	return renderFileSource(source).length;
}
