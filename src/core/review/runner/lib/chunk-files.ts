import type { BotConfig } from "@/core/config/model/bot-config";
import { renderFileDiff } from "@/core/diff/lib/render-file-diff";
import type { DiffFile } from "@/core/diff/model/types";

/**
 * diff가 프롬프트 예산을 넘으면 파일 단위로 쪼갠다.
 *
 * 지침 문서는 청크마다 다시 실리므로 그 길이를 청크 예산에서 미리 뺀다.
 * 다만 파일 하나는 언제나 담을 수 있어야 하므로 maxFileChars를 하한으로 둔다.
 */
export function chunkFiles(
	files: DiffFile[],
	config: BotConfig,
	instructionChars = 0,
	sourceSizes?: Map<string, number>,
): DiffFile[][] {
	const diffBudget = Math.max(
		Math.floor(config.maxPromptChars * 0.5) - instructionChars,
		config.maxFileChars,
	);
	const chunks: DiffFile[][] = [];
	let current: DiffFile[] = [];
	let size = 0;

	for (const file of files) {
		// 원본을 함께 싣는 설정이면 그 길이도 청크에 포함된다 — 빼놓으면 청크가 예산을 넘긴다
		const rendered =
			renderFileDiff(file, config.maxFileChars).length +
			(sourceSizes?.get(file.path) ?? 0);
		if (current.length > 0 && size + rendered > diffBudget) {
			chunks.push(current);
			current = [];
			size = 0;
		}
		current.push(file);
		size += rendered;
	}
	if (current.length) chunks.push(current);
	return chunks.length ? chunks : [[]];
}
