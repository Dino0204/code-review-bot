import type { AssistantMessage, Context, Message } from "@mariozechner/pi-ai";
import { stripThinkBlock } from "@/core/llm/lib/strip-think-block";
import type { LlmClient } from "@/core/llm/model/client";
import { LlmError, OutputTruncatedError } from "@/core/llm/model/errors";
import type { ProviderSpec } from "@/core/llm/model/provider";
import type {
	ChatMessage,
	TokenUsage,
	ToolCall,
	ToolChatResult,
} from "@/core/llm/model/types";
import { log } from "@/core/ports/logger";
import { describeNetworkError } from "@/modules/net";
import { loadPi, toPiModel, toPiTools } from "./pi";

/** 대화 한 줄을 pi-ai 메시지로 옮긴다. system 은 여기 오지 않는다 — 위에서 걸러진다 */
function toPiMessage(message: ChatMessage): Message | undefined {
	const timestamp = Date.now();
	switch (message.role) {
		case "system":
			return undefined;
		case "user":
			return { role: "user", content: message.content, timestamp };
		case "assistant":
			return {
				role: "assistant",
				content: [
					...(message.content
						? [{ type: "text" as const, text: message.content }]
						: []),
					...(message.toolCalls ?? []).map((call) => ({
						type: "toolCall" as const,
						id: call.id,
						name: call.name,
						arguments: call.arguments,
					})),
				],
				api: "openai-completions",
				provider: "replay",
				model: "replay",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp,
			};
		case "toolResult":
			return {
				role: "toolResult",
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				content: [{ type: "text", text: message.content }],
				isError: false,
				timestamp,
			};
	}
}

/** 여러 개가 와도 하나로 합친다 — pi-ai 의 Context 는 시스템 프롬프트를 하나만 받는다 */
function systemPrompt(messages: ChatMessage[]): string | undefined {
	const parts = messages
		.filter((message) => message.role === "system")
		.map((message) => message.content);
	return parts.length ? parts.join("\n\n") : undefined;
}

function readResult(response: AssistantMessage): ToolChatResult {
	const toolCalls: ToolCall[] = [];
	const texts: string[] = [];

	for (const block of response.content) {
		if (block.type === "toolCall")
			toolCalls.push({
				id: block.id,
				name: block.name,
				arguments: block.arguments,
			});
		else if (block.type === "text") texts.push(block.text);
	}

	return { toolCalls, text: stripThinkBlock(texts.join("\n")) };
}

/**
 * provider 하나에 붙는 클라이언트.
 *
 * 도구는 네이티브 tool calling 으로 넘긴다 — 서버가 그래머를 강제하므로 형식이 깨진
 * 응답을 우리가 파싱해 건져낼 일이 없다. 실패는 그대로 던지고, 어느 provider 로
 * 넘길지는 체인이 정한다.
 */
export function createLlmClient(spec: ProviderSpec): LlmClient {
	const totalUsage: TokenUsage = {
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
	};

	return {
		totalUsage,

		async chatWithTools(messages, tools, options = {}) {
			const pi = await loadPi();
			const model = toPiModel(pi, spec);
			const context: Context = {
				...(systemPrompt(messages)
					? { systemPrompt: systemPrompt(messages) }
					: {}),
				messages: messages
					.map(toPiMessage)
					.filter((message): message is Message => message !== undefined),
				tools: toPiTools(tools),
			};

			const maxTokens = Math.min(
				options.maxTokens ?? model.maxTokens,
				model.maxTokens,
			);

			let response: AssistantMessage;
			try {
				response = await pi.complete(model, context, {
					apiKey: spec.apiKey,
					temperature: options.temperature ?? 0.2,
					maxTokens,
					timeoutMs: spec.timeoutMs,
					// SDK 가 timeoutMs 를 안 보는 경로도 있어 신호로도 끊는다
					signal: AbortSignal.timeout(spec.timeoutMs),
				});
			} catch (error) {
				throw new LlmError(
					`${spec.name} 호출 실패: ${describeNetworkError(error)}`,
					error instanceof Error ? error.message : String(error),
				);
			}

			totalUsage.prompt_tokens += response.usage.input;
			totalUsage.completion_tokens += response.usage.output;
			totalUsage.total_tokens += response.usage.totalTokens;

			if (
				response.stopReason === "error" ||
				response.stopReason === "aborted"
			) {
				const detail = response.errorMessage ?? "이유를 주지 않았다";
				throw new LlmError(
					`${spec.name} 응답 실패(${response.stopReason}): ${detail}`,
					detail,
				);
			}

			const result = readResult(response);
			log.info(
				`${spec.name} 응답 — stop=${response.stopReason}, 도구 ${result.toolCalls.length}건`,
				{
					provider: spec.name,
					model: spec.model,
					stopReason: response.stopReason,
					toolCalls: result.toolCalls.length,
					inputTokens: response.usage.input,
					outputTokens: response.usage.output,
				},
			);

			// 잘린 응답은 도구 호출이 중간에서 끊겼을 수 있다. 받은 만큼 쓰면 지적 몇 건이
			// 소리 없이 사라지므로 여기서 멈추고 배치를 쪼개게 한다.
			if (response.stopReason === "length")
				throw new OutputTruncatedError(
					`${spec.name} 응답이 출력 상한(${maxTokens})에서 잘렸다`,
				);

			return result;
		},
	};
}
