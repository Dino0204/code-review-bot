import type { DiffFile } from "@/core/diff/model/types";

/**
 * 배치를 반으로 쪼갠다.
 *
 * 컨텍스트를 넘겼거나 남은 provider 예산에 안 들어갈 때 쓴다. 파일 하나짜리 배치는
 * 더 쪼갤 수 없으므로 undefined 를 돌려준다 — 그 파일은 이번 리뷰에서 빠지고
 * 요약에 못 본 파일로 적힌다.
 */
export function splitBatch(
	batch: DiffFile[],
): [DiffFile[], DiffFile[]] | undefined {
	if (batch.length < 2) return undefined;
	const middle = Math.ceil(batch.length / 2);
	return [batch.slice(0, middle), batch.slice(middle)];
}
