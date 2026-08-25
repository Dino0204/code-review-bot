import { log } from "./logger";
import { describeNetworkError } from "./net";

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

export class LlmError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LlmError";
	}
}

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

export interface LlmClientOptions {
	apiKey: string;
	baseUrl?: string;
	model: string;
	timeoutMs?: number;
}

/**
 * OpenAI 호환 chat completion 클라이언트.
 *
 * 호출하고 응답을 파싱하는 것이 전부다. 규격을 벗어난 응답은 그대로 실패한다 —
 * 서버가 규격을 지키게 하는 것이 클라이언트가 우회하는 것보다 낫다.
 */
export class LlmClient {
	readonly model: string;
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly timeoutMs: number;

	/** 이번 실행에서 누적된 토큰 사용량 */
	readonly totalUsage: TokenUsage = {
		prompt_tokens: 0,
		completion_tokens: 0,
		total_tokens: 0,
	};

	constructor(options: LlmClientOptions) {
		if (!options.apiKey) throw new LlmError("API 키가 비어 있다");
		this.apiKey = options.apiKey;
		this.baseUrl = (
			options.baseUrl ?? "http://ssh.gsmsv.site:26145/v1"
		).replace(/\/+$/, "");
		this.model = options.model;
		this.timeoutMs = options.timeoutMs ?? 600_000;
	}

	private async chat(
		messages: ChatMessage[],
		options: ChatOptions = {},
	): Promise<string> {
		const maxTokens = options.maxTokens ?? 8192;
		const body: Record<string, unknown> = {
			model: this.model,
			messages,
			stream: false,
			temperature: options.temperature ?? 0.2,
			max_tokens: maxTokens,
		};

		let response: Response;
		try {
			response = await fetch(`${this.baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(this.timeoutMs),
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
			this.totalUsage.prompt_tokens += data.usage.prompt_tokens ?? 0;
			this.totalUsage.completion_tokens += data.usage.completion_tokens ?? 0;
			this.totalUsage.total_tokens += data.usage.total_tokens ?? 0;
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

	/**
	 * 도구를 제시하고 모델이 호출한 결과를 받아온다.
	 *
	 * GSML 게이트웨이는 OpenAI의 `tools` 파라미터를 조용히 버린다(HTTP 200에 에러도 없다) —
	 * 상류 llama.cpp가 `--jinja` 없이 떠 있어 채팅 템플릿의 도구 분기가 실행되지 않기 때문이다.
	 * 그래서 템플릿이 해줬어야 할 일을 여기서 직접 한다: 도구 정의를 system 메시지로 주입하고
	 * 응답의 `<tool_call>` XML을 직접 파싱한다. 자세한 근거는 buildToolSystemBlock 주석에 있다.
	 */
	async chatWithTools(
		messages: ChatMessage[],
		tools: ToolDefinition[],
		options: ChatOptions = {},
	): Promise<ToolChatResult> {
		const content = await this.chat(
			withToolSystemBlock(messages, tools),
			options,
		);
		log.debug(`모델 원문 응답\n${content}`);
		return parseToolCalls(stripThinkBlock(content));
	}
}

/**
 * 도구 정의를 담은 system 블록을 맨 앞에 세운다.
 *
 * 채팅 템플릿은 도구가 있을 때 도구 블록을 먼저 쓰고 그 뒤에 원래 system 내용을 붙인다.
 * 같은 순서를 지켜야 모델이 학습된 배치와 어긋나지 않는다.
 */
function withToolSystemBlock(
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

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/**
 * `<think>...</think>` 블록을 걷어낸다. 이 모델은 항상 본문 앞에 추론을 붙이는데,
 * 그 안에서 답안을 미리 적어보는 일이 있어 — 걷어내지 않으면 초안에 들어 있는
 * `<tool_call>` 예시까지 실제 호출로 잡힌다.
 *
 * 여는 태그만 있고 닫히지 않았다면 응답 전체가 추론 도중에 잘린 것이다. 그 원문을 그대로
 * 넘기면 초안의 `<tool_call>` 이 실제 지적으로, 추론 문장이 리뷰 요약으로 PR에 게시된다 —
 * 잘렸다는 사실은 아무 데도 드러나지 않는다. 우회하지 않고 여기서 실패시킨다.
 */
export function stripThinkBlock(raw: string): string {
	const end = raw.indexOf(THINK_CLOSE);
	if (end !== -1) return raw.slice(end + THINK_CLOSE.length);

	if (raw.includes(THINK_OPEN)) {
		throw new LlmError(
			`모델 추론(${THINK_OPEN})이 닫히지 않았다 — 응답이 잘려 본문을 신뢰할 수 없다. ` +
				"max_tokens 를 늘리거나 리뷰 범위를 줄여야 한다",
		);
	}
	return raw;
}
