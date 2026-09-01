export interface ReviewMeta {
	reviewedFiles: number;
	skippedFiles: number;
	/** 지난 리뷰 이후 그대로라 이번에 건너뛴 파일 수 */
	unchangedFiles?: number;
	/** 이번에 리뷰를 못 마친 파일 */
	failedFiles?: string[];
	/** 이미 달려 있어 다시 달지 않은 지적 수 */
	repeatedFindings?: number;
	promptTokens?: number;
	completionTokens?: number;
	chunks: number;
}
