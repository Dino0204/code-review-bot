import type { ReviewResult } from "../../schema/model/review-result";

export function mergeResults(results: ReviewResult[]): ReviewResult {
	if (results.length === 1) return results[0]!;

	return {
		summary: results
			.map((result) => result.summary.trim())
			.filter(Boolean)
			.join("\n\n"),
		findings: results.flatMap((result) => result.findings),
	};
}
