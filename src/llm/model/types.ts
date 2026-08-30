export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

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

/**
 * 모델이 호출한 도구 하나.
 * 값은 XML 텍스트에서 그대로 뽑아낸 문자열이다 — 타입 변환은 zod 스키마가 맡는다.
 */
export interface ToolCall {
	name: string;
	arguments: Record<string, string>;
}

export interface ToolChatResult {
	toolCalls: ToolCall[];
	/** 도구 호출을 걷어낸 나머지 본문 (`<think>` 블록 제외) */
	text: string;
	/** `<think>` 만 걷어낸 원문. 대화를 이어갈 때 assistant 차례로 되싣는다 */
	raw: string;
}

export interface LlmClientOptions {
	apiKey: string;
	baseUrl?: string;
	timeoutMs?: number;
}
