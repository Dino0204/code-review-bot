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
	/**
	 * 헤더가 선언한 줄 수와 실제로 센 줄 수가 맞는지.
	 *
	 * GitHub 은 patch 가 크면 잘라서 준다. 잘린 헝크는 헤더의 `newLines` 만큼 줄이 없는데,
	 * 그것을 근거로 줄 번호를 계산하면 실제로 없는 줄에 코멘트를 달게 되어 422 가 난다.
	 */
	complete: boolean;
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
