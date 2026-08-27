export type DiffLineType = "add" | "del" | "ctx";

export interface DiffLine {
	type: DiffLineType;
	content: string;
	/** 변경 전 파일에서의 줄 번호 (추가된 줄이면 undefined) */
	oldLine?: number;
	/** 변경 후 파일에서의 줄 번호 (삭제된 줄이면 undefined) */
	newLine?: number;
}

export interface DiffHunk {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	/** @@ 뒤에 붙는 컨텍스트 문자열 (보통 함수 시그니처) */
	section: string;
	lines: DiffLine[];
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffFile {
	path: string;
	previousPath?: string;
	status: FileStatus;
	hunks: DiffHunk[];
	additions: number;
	deletions: number;
	isBinary: boolean;
}
