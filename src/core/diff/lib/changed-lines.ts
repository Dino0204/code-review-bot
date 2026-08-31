import type { DiffFile } from "../model/types";

/** 실제로 추가/수정된 줄. 모델이 엉뚱한 컨텍스트 줄을 지목했을 때 스냅 기준이 된다. */
export function changedLines(file: DiffFile): Set<number> {
	const lines = new Set<number>();
	for (const hunk of file.hunks) {
		for (const line of hunk.lines) {
			if (line.type === "add" && line.newLine !== undefined)
				lines.add(line.newLine);
		}
	}
	return lines;
}
