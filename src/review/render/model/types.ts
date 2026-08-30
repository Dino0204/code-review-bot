export interface ReviewMeta {
	reviewedFiles: number;
	skippedFiles: number;
	promptTokens?: number;
	completionTokens?: number;
	chunks: number;
}
