import type { BotConfig } from "../../../config/model/bot-config";
import { SEVERITY_LABEL } from "../../schema/consts/severity-label";
import type { Finding } from "../../schema/model/finding";
import type { ReviewResult } from "../../schema/model/review-result";
import { BOT_MARKER } from "../consts/marker";
import type { ReviewMeta } from "../model/types";

function countBySeverity(
	findings: Finding[],
): Record<Finding["severity"], number> {
	const counts = { critical: 0, major: 0, minor: 0, nit: 0 };
	for (const finding of findings) counts[finding.severity]++;
	return counts;
}

export function renderReviewSummary(
	result: ReviewResult,
	inline: Finding[],
	overflow: Finding[],
	meta: ReviewMeta,
	config: BotConfig,
): string {
	const counts = countBySeverity([...inline, ...overflow]);
	const badge = [
		counts.critical ? `🔴 ${counts.critical}` : "",
		counts.major ? `🟠 ${counts.major}` : "",
		counts.minor ? `🟡 ${counts.minor}` : "",
		counts.nit ? `⚪ ${counts.nit}` : "",
	]
		.filter(Boolean)
		.join(" · ");

	const parts = [
		BOT_MARKER,
		"## 🤖 코드 리뷰",
		"",
		result.summary.trim() || "_요약을 생성하지 못했다._",
		"",
		badge
			? `**지적 사항:** ${badge}`
			: "**지적 사항 없음** — 변경분에서 문제를 찾지 못했다.",
	];

	if (overflow.length) {
		parts.push(
			"",
			"<details><summary>인라인으로 달지 못한 지적 " +
				overflow.length +
				"건 (diff 범위 밖이거나 개수 제한 초과)</summary>",
			"",
			...overflow.map(
				(finding) =>
					`- **${SEVERITY_LABEL[finding.severity]}** \`${finding.file}:${finding.line}\` — ${finding.title}\n  ${finding.detail.replace(/\n/g, "\n  ")}`,
			),
			"",
			"</details>",
		);
	}

	const stats = [
		`모델 \`${meta.model}\``,
		`파일 ${meta.reviewedFiles}개 리뷰${meta.skippedFiles ? ` (${meta.skippedFiles}개 제외)` : ""}`,
		meta.chunks > 1 ? `${meta.chunks}개 청크로 분할` : "",
		meta.promptTokens !== undefined
			? `토큰 ${meta.promptTokens.toLocaleString()} in / ${(meta.completionTokens ?? 0).toLocaleString()} out`
			: "",
	]
		.filter(Boolean)
		.join(" · ");

	parts.push("", "---", `<sub>${stats}</sub>`);

	return parts.join("\n");
}
