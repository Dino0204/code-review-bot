import type { ToolCall, ToolChatResult } from "../model/types";

const TOOL_CALL_PATTERN = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
const FUNCTION_NAME_PATTERN = /<function=([^>\s]+)\s*>/;
const PARAMETER_PATTERN = /<parameter=([^>\s]+)\s*>([\s\S]*?)<\/parameter>/g;

/**
 * 응답에서 `<tool_call>` 블록을 뽑아낸다.
 *
 * 닫히지 않은 블록(출력이 max_tokens에 잘린 경우)은 값이 온전하지 않으므로 버린다.
 * 이름을 읽지 못한 블록도 버린다 — 어떤 도구인지 모르면 검증할 수 없다.
 */
export function parseToolCalls(content: string): ToolChatResult {
	const toolCalls: ToolCall[] = [];

	for (const match of content.matchAll(TOOL_CALL_PATTERN)) {
		const block = match[1] ?? "";
		const name = FUNCTION_NAME_PATTERN.exec(block)?.[1];
		if (!name) continue;

		const args: Record<string, string> = {};
		for (const param of block.matchAll(PARAMETER_PATTERN)) {
			const key = param[1];
			if (key !== undefined) args[key] = trimParameterValue(param[2] ?? "");
		}
		toolCalls.push({ name, arguments: args });
	}

	return {
		toolCalls,
		text: content.replace(TOOL_CALL_PATTERN, "").trim(),
		raw: content.trim(),
	};
}

/**
 * 값을 감싸고 있는 줄바꿈 한 겹만 벗긴다.
 *
 * 템플릿이 값을 제 줄에 놓기 때문에 앞뒤로 줄바꿈이 하나씩 붙는다. trim으로 몰아서 지우면
 * 코드 제안(suggestion)의 들여쓰기가 무너지므로, 정확히 한 겹만 벗기고 나머지는 보존한다.
 */
function trimParameterValue(value: string): string {
	return value.replace(/^\r?\n/, "").replace(/\r?\n[ \t]*$/, "");
}
