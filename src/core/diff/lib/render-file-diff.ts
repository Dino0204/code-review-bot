import type { DiffFile } from "../model/types";

/**
 * 모델이 줄 번호를 정확히 인용할 수 있도록 좌측에 변경 후 줄 번호를 붙여 렌더링한다.
 * 삭제된 줄은 번호 자리를 비우고 `-`로 표시한다.
 */
export function renderFileDiff(file: DiffFile, maxChars = 24_000): string {
	const header = `### ${file.path}${file.previousPath && file.previousPath !== file.path ? ` (이전 경로: ${file.previousPath})` : ""} — ${file.status}, +${file.additions}/-${file.deletions}`;
	if (file.isBinary) return `${header}\n(바이너리 파일 — 내용 생략)`;

	const body: string[] = [];
	for (const hunk of file.hunks) {
		body.push(
			`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.section}`.trimEnd(),
		);
		for (const line of hunk.lines) {
			const number =
				line.newLine === undefined
					? "    "
					: String(line.newLine).padStart(4, " ");
			const marker =
				line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
			body.push(`${number} ${marker} ${line.content}`);
		}
	}

	const rendered = `${header}\n${body.join("\n")}`;
	if (rendered.length <= maxChars) return rendered;
	return `${rendered.slice(0, maxChars)}\n… (diff가 너무 길어 이후 생략)`;
}
