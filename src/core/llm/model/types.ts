/**
 * 모델이 부른 도구 하나.
 *
 * `id` 는 provider 가 붙인 것이다 — 결과를 돌려줄 때 이 id 로 짝을 짓는다.
 * 값은 네이티브 tool calling 이 돌려준 JSON 그대로라 타입이 정해져 있지 않다.
 * 타입 변환과 검증은 `review/schema` 의 zod 스키마가 맡는다.
 */
export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

/**
 * 모델에 실어보낼 대화 한 줄.
 *
 * `assistant` 와 `toolResult` 는 도구 루프를 이어갈 때 쓴다 — 모델이 부른 도구를
 * 그대로 되싣고 그 결과를 짝지어 붙여야 다음 차례가 앞뒤를 안다. 문자열로 흉내 내던
 * 예전 방식과 달리 도구 호출은 구조로 오간다.
 */
export type ChatMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string }
	| { role: "assistant"; content: string; toolCalls?: ToolCall[] }
	| {
			role: "toolResult";
			toolCallId: string;
			toolName: string;
			content: string;
	  };

export interface TokenUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

export interface ChatOptions {
	temperature?: number;
	maxTokens?: number;
}

/** 모델에게 제시할 도구 하나. parameters는 JSON Schema 객체다. */
export interface ToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export interface ToolChatResult {
	toolCalls: ToolCall[];
	/** 도구 호출과 함께 온 본문. 추론 블록은 이미 걷어냈다 */
	text: string;
}
