import type {
	ChatMessage,
	ChatOptions,
	TokenUsage,
	ToolChatResult,
	ToolDefinition,
} from "./types";

/**
 * 모델에게 도구를 제시하고 호출 결과를 받아오는 포트.
 *
 * 규격을 벗어난 응답은 그대로 실패한다 — 모델이 규격을 지키게 하는 것이
 * 클라이언트가 우회하는 것보다 낫다. 어떤 API로 어떻게 부르는지는 구현이 정한다.
 */
export interface LlmClient {
	/** 이번 실행에서 누적된 토큰 사용량 */
	readonly totalUsage: TokenUsage;
	/**
	 * 도구를 제시하고 모델이 호출한 결과를 받아온다.
	 *
	 * 모델이 도구를 아예 안 부를 수 있다 — 빈 `toolCalls` 로 돌아오며, 그것을 어떻게
	 * 다룰지는 호출부가 정한다.
	 */
	chatWithTools(
		messages: ChatMessage[],
		tools: ToolDefinition[],
		options?: ChatOptions,
	): Promise<ToolChatResult>;
}
