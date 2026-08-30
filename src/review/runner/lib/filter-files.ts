import { minimatch } from "minimatch";
import type { BotConfig } from "@/config/model/bot-config";
import type { DiffFile } from "@/github/diff/model/types";

export function filterFiles(
	files: DiffFile[],
	config: BotConfig,
): { selected: DiffFile[]; skipped: number } {
	const matched = files.filter((file) => {
		if (file.isBinary) return false;
		if (file.status === "deleted") return false; // 삭제된 파일에는 코멘트를 달 수 없다
		if (
			config.include.length &&
			!config.include.some((pattern) =>
				minimatch(file.path, pattern, { dot: true }),
			)
		)
			return false;
		if (
			config.exclude.some((pattern) =>
				minimatch(file.path, pattern, { dot: true }),
			)
		)
			return false;
		return file.hunks.length > 0;
	});

	// 변경량이 큰 파일부터 — 예산이 모자라면 사소한 파일이 잘려나가게 한다
	const sorted = [...matched].sort(
		(a, b) => b.additions + b.deletions - (a.additions + a.deletions),
	);
	const selected = sorted.slice(0, config.maxFiles);
	return { selected, skipped: files.length - selected.length };
}
