import type { ToolCall } from "../../../llm/model/types";
import { log } from "../../../logger";
import { FINDING_TOOL, SUMMARY_TOOL } from "../../prompt/consts/tools";
import type { RawFinding } from "../../schema/model/finding";
import { findingSchema } from "../../schema/model/finding";
import type { ReviewResult } from "../../schema/model/review-result";

/**
 * 도구 호출을 리뷰 결과로 모은다.
 *
 * 모델 출력은 신뢰하지 않는다 — 스키마에 맞지 않는 지적은 버리고 나머지는 살린다.
 * 하나가 어긋났다고 리뷰 전체를 잃는 것보다, 검증을 통과한 것만 게시하는 편이 낫다.
 */
export function collectToolCalls(toolCalls: ToolCall[]): ReviewResult {
	const summaries: string[] = [];
	const findings: RawFinding[] = [];
	let malformed = 0;
	let unknown = 0;

	for (const call of toolCalls) {
		if (call.name === SUMMARY_TOOL) {
			const summary = call.arguments["summary"]?.trim();
			if (summary) summaries.push(summary);
			continue;
		}
		if (call.name !== FINDING_TOOL) {
			log.warn(`모델이 알 수 없는 도구를 호출했다: ${call.name}`);
			unknown++;
			continue;
		}

		const parsed = findingSchema.safeParse(call.arguments);
		if (parsed.success) {
			findings.push(parsed.data);
			continue;
		}
		malformed++;
		const issues = parsed.error.issues
			.slice(0, 3)
			.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
			.join("; ");
		log.warn(`지적 하나가 스키마와 맞지 않아 버렸다 — ${issues}`);
	}

	// 지적이 0건일 때 원인을 가릴 수 있어야 한다 —
	// 모델이 요약만 낸 것과, 낸 지적이 검증에서 떨어진 것은 서로 다른 문제다.
	log.info(
		`도구 호출 ${toolCalls.length}건 — 요약 ${summaries.length}, 지적 ${findings.length}` +
			(malformed ? `, 형식 오류 ${malformed}` : "") +
			(unknown ? `, 모르는 도구 ${unknown}` : ""),
	);

	return { summary: summaries.join("\n\n"), findings };
}
