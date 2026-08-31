import type { DiffFile } from "../model/types";

export function totalChangedLines(files: DiffFile[]): number {
	return files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
}
