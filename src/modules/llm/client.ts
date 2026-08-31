import { parseToolCalls } from "@/core/llm/lib/parse-tool-calls";
import { stripThinkBlock } from "@/core/llm/lib/strip-think-block";
import { withToolSystemBlock } from "@/core/llm/lib/tool-system-block";
import type { LlmClient } from "@/core/llm/model/client";
import { LlmError } from "@/core/llm/model/errors";
import type {
	ChatMessage,
	ChatOptions,
	LlmClientOptions,
	TokenUsage,
} from "@/core/llm/model/types";
import { log } from "@/core/ports/logger";
import { describeNetworkError } from "@/modules/net";

interface ChatCompletion {
	choices?: Array<{
		finish_reason?: string;
		message?: { content?: string | null };
	}>;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
	error?: { message?: string };
}

/**
 * GSML 게이트웨이용 구현.
 *
 * 이 게이트웨이는 OpenAI의 `tools` 파라미터를 조용히 버린다(HTTP 200에 에러도 없다) —
 * 상류 llama.cpp가 `--jinja` 없이 떠 있어 채팅 템플릿의 도구 분기가 실행되지 않기 때문이다.
 * 그래서 템플릿이 해줬어야 할 일을 여기서 직접 한다: 도구 정의를 system 메시지로 주입하고
 * 응답의 `<tool_call>` XML을 직접 파싱한다. 자세한 근거는 buildToolSystemBlock 주석에 있다.
 */
export function createLlmClient(options: LlmClientOptions): LlmClient {
	if (!options.apiKey) throw new LlmError("API 키가 비어 있다");
	const apiKey = options.apiKey;
	const baseUrl = (options.baseUrl ?? "http://ssh.gsmsv.site:26145/v1").replace(
		/\/+$/,
		"",
	);
	const timeoutMs = options.timeoutMs ?? 600_000;

	const totalUsage: TokenUsage = {
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
	};

	async function chat(
		messages: ChatMessage[],
		chatOptions: ChatOptions = {},
	): Promise<string> {
		const maxTokens = chatOptions.maxTokens ?? 8192;
		// GSML 게이트웨이는 모델 하나만 서빙하고 body의 model 필드를 무시하므로 넘기지 않는다.
		const body: Record<string, unknown> = {
			messages,
			stream: false,
			temperature: chatOptions.temperature ?? 0.2,
			max_tokens: maxTokens,
		};

		let response: Response;
		try {
			response = await fetch(`${baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (error) {
			throw new LlmError(
				`모델 서버 네트워크 오류: ${describeNetworkError(error)}`,
			);
		}

		const text = await response.text();
		if (!response.ok)
			throw new LlmError(
				`모델 서버 HTTP ${response.status}: ${text.slice(0, 500)}`,
			);

		let data: ChatCompletion;
		try {
			data = JSON.parse(text) as ChatCompletion;
		} catch {
			throw new LlmError(`모델 응답이 JSON이 아니다: ${text.slice(0, 300)}`);
		}
		if (data.error?.message)
			throw new LlmError(`모델 오류: ${data.error.message}`);

		if (data.usage) {
			totalUsage.prompt_tokens += data.usage.prompt_tokens ?? 0;
			totalUsage.completion_tokens += data.usage.completion_tokens ?? 0;
			totalUsage.total_tokens += data.usage.total_tokens ?? 0;
		}

		const choice = data.choices?.[0];
		const finishReason = choice?.finish_reason ?? "unknown";
		const usage = data.usage;
		log.info(
			`모델 응답 — finish_reason=${finishReason}` +
				(usage
					? `, 토큰 ${usage.prompt_tokens ?? 0} in / ${usage.completion_tokens ?? 0} out`
					: ""),
		);

		// max_tokens에서 잘린 응답은 `<tool_call>` 이 닫히지 않아 파싱에서 통째로 버려진다.
		// 그러면 결과만 봐서는 모델이 도구를 안 부른 것과 구분되지 않으므로 여기서 남긴다.
		if (finishReason === "length") {
			log.warn(
				`응답이 max_tokens(${maxTokens})에서 잘렸다 — 도구 호출이 온전하지 않을 수 있다`,
			);
		}

		const content = choice?.message?.content ?? "";
		if (!content.trim()) {
			throw new LlmError(
				`모델이 빈 응답을 반환했다 (finish_reason=${finishReason})`,
			);
		}
		return content;
	}

	return {
		totalUsage,
		async chatWithTools(messages, tools, chatOptions = {}) {
			const content = await chat(
				withToolSystemBlock(messages, tools),
				chatOptions,
			);
			log.debug(`모델 원문 응답\n${content}`);
			return parseToolCalls(stripThinkBlock(content));
		},
	};
}
