export interface ReviewMeta {
	reviewedFiles: number;
	skippedFiles: number;
	/** 지난 리뷰 이후 그대로라 이번에 건너뛴 파일 수 */
	unchangedFiles?: number;
	promptTokens?: number;
	completionTokens?: number;
	chunks: number;
}
