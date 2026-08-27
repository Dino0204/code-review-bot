export interface ReviewMeta {
	model: string;
	reviewedFiles: number;
	skippedFiles: number;
	promptTokens?: number;
	completionTokens?: number;
	chunks: number;
}
