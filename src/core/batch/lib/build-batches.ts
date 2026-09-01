import { renderFileDiff } from "@/core/diff/lib/render-file-diff";
import type { DiffFile } from "@/core/diff/model/types";
import type { BatchBudget } from "../model/types";

/** 파일 하나가 배치에서 차지하는 길이 — diff 와, 함께 싣는 원본까지 센다 */
function fileChars(file: DiffFile, budget: BatchBudget): number {
	return (
		renderFileDiff(file, budget.maxFileChars).length +
		(budget.sourceSizes?.get(file.path) ?? 0)
	);
}

/** 배치 하나가 실어보낼 대략의 길이. 체인이 provider 예산과 견주는 값이다 */
export function batchChars(batch: DiffFile[], budget: BatchBudget): number {
	return (
		budget.instructionChars +
		batch.reduce((sum, file) => sum + fileChars(file, budget), 0)
	);
}

/**
 * diff 가 예산을 넘으면 파일 단위로 나눈다.
 *
 * 경로로 먼저 정렬한다 — 같은 PR 을 다시 보면 같은 묶음이 나와야 마커가 배치를 가로질러
 * 어긋나지 않는다. 지침 문서는 배치마다 다시 실리므로 그 길이를 예산에서 미리 빼고,
 * 파일 하나는 언제나 담을 수 있어야 하므로 maxFileChars 를 하한으로 둔다.
 */
export function buildBatches(
	files: DiffFile[],
	budget: BatchBudget,
): DiffFile[][] {
	const limit = Math.max(
		budget.maxChars - budget.instructionChars,
		budget.maxFileChars,
	);
	const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

	const batches: DiffFile[][] = [];
	let current: DiffFile[] = [];
	let size = 0;

	for (const file of sorted) {
		const rendered = fileChars(file, budget);
		if (current.length > 0 && size + rendered > limit) {
			batches.push(current);
			current = [];
			size = 0;
		}
		current.push(file);
		size += rendered;
	}
	if (current.length) batches.push(current);
	return batches.length ? batches : [[]];
}
