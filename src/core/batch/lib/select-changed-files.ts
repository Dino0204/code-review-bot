import { fileHash } from "@/core/diff/lib/hunk-hash";
import type { DiffFile } from "@/core/diff/model/types";

export interface ChangedSelection {
	/** 마커에 없거나 해시가 달라진 파일 — 이번에 리뷰할 것들 */
	changed: DiffFile[];
	/** 지난 리뷰 이후 내용이 그대로인 파일 */
	unchanged: DiffFile[];
	/** 이번에 리뷰할 파일의 새 마커 값 */
	hashes: Map<string, string>;
}

/**
 * 마커와 대조해 다시 볼 파일만 고른다.
 *
 * 마커는 파일 단위다. 배치 단위로 두면 배치 안에 파일 하나만 바뀌어도 나머지까지
 * 다시 보내게 된다. 해시에 줄 번호가 안 들어가므로(`hunkHash` 참고) 위쪽에 줄이
 * 늘어 아래 헝크가 밀린 것만으로는 다시 리뷰하지 않는다.
 *
 * 크래시 재개와 증분 재리뷰가 같은 경로를 탄다 — 배치 도중 죽었든 push 가 왔든,
 * 마커가 없는 파일만 다시 묶인다.
 */
export function selectChangedFiles(
	files: DiffFile[],
	markers: Map<string, string>,
): ChangedSelection {
	const changed: DiffFile[] = [];
	const unchanged: DiffFile[] = [];
	const hashes = new Map<string, string>();

	for (const file of files) {
		const hash = fileHash(file);
		if (markers.get(file.path) === hash) {
			unchanged.push(file);
			continue;
		}
		changed.push(file);
		hashes.set(file.path, hash);
	}

	return { changed, unchanged, hashes };
}
