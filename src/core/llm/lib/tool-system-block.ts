import type { ChatMessage, ToolDefinition } from "../model/types";

/**
 * 도구 정의를 담은 system 블록을 맨 앞에 세운다.
 *
 * 채팅 템플릿은 도구가 있을 때 도구 블록을 먼저 쓰고 그 뒤에 원래 system 내용을 붙인다.
 * 같은 순서를 지켜야 모델이 학습된 배치와 어긋나지 않는다.
 */
export function withToolSystemBlock(
	messages: ChatMessage[],
	tools: ToolDefinition[],
): ChatMessage[] {
	const block = buildToolSystemBlock(tools);
	const first = messages[0];
	if (first?.role === "system") {
		return [
			{ role: "system", content: `${block}\n\n${first.content}` },
			...messages.slice(1),
		];
	}
	return [{ role: "system", content: block }, ...messages];
}

/**
 * Qwen3.6 채팅 템플릿(`chat_template.jinja`)의 도구 분기가 만들어내는 system 블록을 그대로 재현한다.
 *
 * 이 문자열은 모델이 학습된 형태이므로 임의로 다듬지 않는다 — 문구를 바꾸면 준수율이 떨어진다.
 * 도구 객체는 템플릿의 `tool | tojson`과 맞추기 위해 OpenAI 형태로 감싸서 직렬화한다.
 */
export function buildToolSystemBlock(tools: ToolDefinition[]): string {
	const serialized = tools
		.map((tool) => `\n${JSON.stringify({ type: "function", function: tool })}`)
		.join("");

	return (
		"# Tools\n\nYou have access to the following functions:\n\n<tools>" +
		serialized +
		"\n</tools>" +
		"\n\nIf you choose to call a function ONLY reply in the following format with NO suffix:" +
		"\n\n<tool_call>\n<function=example_function_name>\n<parameter=example_parameter_1>\nvalue_1\n</parameter>" +
		"\n<parameter=example_parameter_2>\nThis is the value for the second parameter\nthat can span\nmultiple lines" +
		"\n</parameter>\n</function>\n</tool_call>\n\n<IMPORTANT>\nReminder:" +
		"\n- Function calls MUST follow the specified format: an inner <function=...></function> block must be nested within <tool_call></tool_call> XML tags" +
		"\n- Required parameters MUST be specified" +
		"\n- You may provide optional reasoning for your function call in natural language BEFORE the function call, but NOT after" +
		"\n- If there is no function call available, answer the question like normal with your current knowledge and do not tell the user about function calls" +
		"\n</IMPORTANT>"
	);
}
