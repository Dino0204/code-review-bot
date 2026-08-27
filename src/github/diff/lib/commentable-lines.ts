import type { DiffFile } from "../model/types";

/** GitHub 리뷰 코멘트를 달 수 있는(=diff에 포함된) 변경 후 파일의 줄 번호 집합 */
export function commentableLines(file: DiffFile): Set<number> {
	const lines = new Set<number>();
	for (const hunk of file.hunks) {
		for (const line of hunk.lines) {
			if (line.newLine !== undefined) lines.add(line.newLine);
		}
	}
	return lines;
}
