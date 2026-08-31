import type { DiffFile } from "../model/types";

/**
 * GitHub 리뷰 코멘트를 달 수 있는(=diff에 포함된) 변경 후 파일의 줄 번호 집합.
 *
 * 불완전한 헝크는 제외한다 — GitHub 이 큰 patch 를 자르면 헤더가 선언한 줄까지 내용이 오지
 * 않는데, 그 헝크의 줄 번호로 코멘트를 달면 GitHub 이 리뷰 전체를 422 로 거절한다.
 */
export function commentableLines(file: DiffFile): Set<number> {
	const lines = new Set<number>();
	for (const hunk of file.hunks) {
		if (!hunk.complete) continue;
		for (const line of hunk.lines) {
			if (line.newLine !== undefined) lines.add(line.newLine);
		}
	}
	return lines;
}
