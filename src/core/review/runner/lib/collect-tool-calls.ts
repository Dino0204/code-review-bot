import { SchemaViolationError } from "@/core/llm/model/errors";
import type { ToolCall } from "@/core/llm/model/types";
import { log } from "@/core/ports/logger";
import { FINDING_TOOL, SUMMARY_TOOL } from "@/core/review/prompt/consts/tools";
import type { RawFinding } from "@/core/review/schema/model/finding";
import { findingSchema } from "@/core/review/schema/model/finding";
import type { ReviewResult } from "@/core/review/schema/model/review-result";

/**
 * 도구 호출을 리뷰 결과로 모은다.
 *
 * 네이티브 tool calling 은 서버가 스키마를 강제하므로, 그러고도 검증에 걸린 지적은
 * 형식 사고가 아니라 모델이 규격을 어긴 것이다. 그런 응답은 덮지 않고 배치째로
 * 실패시킨다 — 덮으면 틀린 줄 번호가 그대로 GitHub 까지 가서 422 가 된다.
 */
export function collectToolCalls(toolCalls: ToolCall[]): ReviewResult {
	const summaries: string[] = [];
	const findings: RawFinding[] = [];
	let unknown = 0;

	for (const call of toolCalls) {
		if (call.name === SUMMARY_TOOL) {
			const summary = String(call.arguments["summary"] ?? "").trim();
			if (summary) summaries.push(summary);
			continue;
		}
		if (call.name !== FINDING_TOOL) {
			log.warn(`모델이 알 수 없는 도구를 호출했다: ${call.name}`);
			unknown++;
			continue;
		}

		const parsed = findingSchema.safeParse(call.arguments);
		if (!parsed.success) {
			const issues = parsed.error.issues
				.slice(0, 3)
				.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
				.join("; ");
			throw new SchemaViolationError(
				`${FINDING_TOOL} 응답이 스키마와 맞지 않다 — ${issues}`,
			);
		}
		findings.push(parsed.data);
	}

	// 지적이 0건일 때 원인을 가릴 수 있어야 한다 —
	// 모델이 요약만 낸 것과, 아예 도구를 안 부른 것은 서로 다른 문제다.
	log.info(
		`도구 호출 ${toolCalls.length}건 — 요약 ${summaries.length}, 지적 ${findings.length}` +
			(unknown ? `, 모르는 도구 ${unknown}` : ""),
		{ toolCalls: toolCalls.length, findings: findings.length },
	);

	return { summary: summaries.join("\n\n"), findings };
}
