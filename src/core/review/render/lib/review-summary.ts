import type { BotConfig } from "@/core/config/model/bot-config";
import { SEVERITY_LABEL } from "@/core/review/schema/consts/severity-label";
import type { Finding } from "@/core/review/schema/model/finding";
import type { ReviewResult } from "@/core/review/schema/model/review-result";
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

	// 못 본 파일이 있으면 접어두지 않고 본문에 적는다 — 리뷰가 온전하지 않다는 사실은
	// 사람이 반드시 알아야 한다
	if (meta.failedFiles?.length) {
		const shown = meta.failedFiles.slice(0, 10);
		const rest = meta.failedFiles.length - shown.length;
		parts.push(
			"",
			"> [!WARNING]",
			`> 다음 ${meta.failedFiles.length}개 파일은 이번에 리뷰하지 못했다. 재시도가 남아 있으면 자동으로 다시 보고, 아니면 \`/review\` 로 다시 부르면 된다.`,
			">",
			`> ${shown.map((path) => `\`${path}\``).join(", ")}${rest ? ` 외 ${rest}개` : ""}`,
		);
	}

	const stats = [
		`파일 ${meta.reviewedFiles}개 리뷰${meta.skippedFiles ? ` (${meta.skippedFiles}개 제외)` : ""}`,
		meta.unchangedFiles ? `${meta.unchangedFiles}개는 변경 없어 건너뜀` : "",
		meta.repeatedFindings
			? `이미 달린 지적 ${meta.repeatedFindings}건은 생략`
			: "",
		meta.chunks > 1 ? `${meta.chunks}개 청크로 분할` : "",
		meta.promptTokens !== undefined
			? `토큰 ${meta.promptTokens.toLocaleString()} in / ${(meta.completionTokens ?? 0).toLocaleString()} out`
			: "",
		meta.models?.length ? `모델 ${meta.models.join(", ")}` : "",
	]
		.filter(Boolean)
		.join(" · ");

	parts.push("", "> [!NOTE]", `> ${stats}`);

	return parts.join("\n");
}
