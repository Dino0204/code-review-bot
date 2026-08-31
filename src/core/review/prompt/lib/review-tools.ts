import type { BotConfig } from "@/core/config/model/bot-config";
import { SEVERITIES } from "@/core/config/model/severity";
import type { ToolDefinition } from "@/core/llm/model/types";
import { FINDING_TOOL, READ_TOOL, SUMMARY_TOOL } from "../consts/tools";
import { languageName } from "./language-name";

/**
 * 모델에게 제시할 도구.
 *
 * 값은 XML 텍스트로 오가므로 여기 적은 JSON Schema는 모델을 안내하는 역할만 한다 —
 * 실제 타입 검증은 `review/schema` 의 zod 스키마가 맡는다. 둘의 필드 이름은 반드시 맞춰야 한다.
 */
export function reviewTools(config: BotConfig): ToolDefinition[] {
	return [
		{
			name: SUMMARY_TOOL,
			description:
				"이번 PR 전체에 대한 요약과 평가를 제출한다. 리뷰마다 정확히 한 번 호출한다.",
			parameters: {
				type: "object",
				properties: {
					summary: {
						type: "string",
						description: `변경 내용 요약과 전반적인 평가. 마크다운 3~6줄, ${languageName(config.language)}.`,
					},
				},
				required: ["summary"],
			},
		},
		{
			name: FINDING_TOOL,
			description:
				"발견한 문제 하나를 인라인 코멘트로 제출한다. 발견마다 한 번씩 호출한다.",
			parameters: {
				type: "object",
				properties: {
					file: {
						type: "string",
						description: "리포지토리 루트 기준 파일 경로",
					},
					line: {
						type: "integer",
						description:
							"변경 후 파일 기준 줄 번호. diff 왼쪽에 붙은 숫자를 그대로 쓴다.",
					},
					end_line: {
						type: "integer",
						description:
							"여러 줄에 걸친 지적일 때의 끝 줄. 한 줄이면 생략한다.",
					},
					severity: { type: "string", enum: [...SEVERITIES] },
					title: { type: "string", description: "한 줄 요약" },
					detail: {
						type: "string",
						description: "왜 문제인지와 어떻게 고칠지. 마크다운 허용.",
					},
					suggestion: {
						type: "string",
						description:
							"line 줄을 그대로 대체할 수 있는 완성된 코드. 아니면 생략한다.",
					},
				},
				required: ["file", "line", "severity", "title", "detail"],
			},
		},
		...(config.maxExtraReads > 0
			? [
					{
						name: READ_TOOL,
						description:
							"리뷰에 필요한 파일의 현재 내용을 읽는다. 이번 diff에 없는 파일도 읽을 수 있다. 이 도구를 부를 때는 다른 도구를 함께 호출하지 않는다.",
						parameters: {
							type: "object",
							properties: {
								path: {
									type: "string",
									description:
										"리포지토리 루트 기준 파일 경로. 예: src/review/runner.ts",
								},
							},
							required: ["path"],
						},
					},
				]
			: []),
	];
}
