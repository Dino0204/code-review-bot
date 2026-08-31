import { createHash } from "node:crypto";
import type { DiffFile, DiffHunk } from "../model/types";

/**
 * 헝크의 내용 해시. **줄 번호는 넣지 않는다.**
 *
 * 파일 위쪽에 줄이 추가되면 아래 헝크는 내용이 한 글자도 안 바뀌었는데 `newStart` 가 밀린다.
 * 줄 번호를 해시에 넣으면 그때마다 다시 리뷰하게 되어 증분의 의미가 사라진다.
 *
 * 각 조각 앞에 길이를 붙여 잇는다 — 그냥 이어붙이면 `("ab", "c")` 와 `("a", "bc")` 가
 * 같은 해시를 갖는다.
 */
export function hunkHash(hunk: DiffHunk): string {
	const body = hunk.lines
		.map((line) => {
			const marker =
				line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
			return marker + line.content;
		})
		.join("\n");

	const hash = createHash("sha256");
	for (const part of ["diff-hunk-v1", hunk.section, body]) {
		hash.update(String(part.length));
		hash.update("\0");
		hash.update(part);
	}
	return hash.digest("hex");
}

/**
 * 파일의 내용 해시. 이 값이 마커에 저장되어 "이 파일은 이미 봤다"의 근거가 된다.
 *
 * 불완전한 헝크는 빼고 센다 — GitHub 이 patch 를 어디서 자르는지에 따라 값이 흔들리면
 * 안 바뀐 파일이 매번 다시 리뷰된다.
 */
export function fileHash(file: DiffFile): string {
	const hash = createHash("sha256");
	hash.update("diff-file-v1\0");
	hash.update(file.path);
	for (const hunk of file.hunks) {
		if (!hunk.complete) continue;
		hash.update("\0");
		hash.update(hunkHash(hunk));
	}
	return hash.digest("hex");
}
