import type { DiffFile } from "../model/types";
import { commentableLines } from "./commentable-lines";

/**
 * 모델이 지목한 줄이 diff 밖이면 가까운 유효 줄로 당겨온다.
 * window를 넘어가면 undefined — 인라인 대신 요약에만 싣는다.
 */
export function snapToCommentableLine(
	file: DiffFile,
	line: number,
	window = 5,
): number | undefined {
	const valid = commentableLines(file);
	if (valid.has(line)) return line;
	for (let delta = 1; delta <= window; delta++) {
		if (valid.has(line - delta)) return line - delta;
		if (valid.has(line + delta)) return line + delta;
	}
	return undefined;
}
