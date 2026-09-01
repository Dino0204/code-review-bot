import {
	LlmError,
	OutputTruncatedError,
	SchemaViolationError,
	SplitRequiredError,
} from "../model/errors";
import type { ErrorClass } from "../model/provider";

/** 한도를 다 썼다 — 시간 단위로 쉬어야 한다 */
const QUOTA =
	/insufficient_quota|out of budget|usage limit reached|quota exceeded|exceeded your current quota|billing hard limit/;
const RATE_LIMIT = /rate.?limit|too many requests|resource_exhausted/;
/** 프롬프트가 안 들어간다 — provider 를 바꿔도 그대로다 */
const TOO_LARGE =
	/context length|context_length_exceeded|too many tokens|maximum context|prompt is too long|token count exceeds|exceeds the maximum number of tokens|input is too long/;
/** 다시 불러도 같은 결과가 나온다 — 이번 잡에서 그 provider 를 뺀다 */
const FAIL_FAST =
	/api key not valid|api_key_invalid|invalid api key|incorrect api key|missing authentication|unauthenticated|unauthorized|permission.?denied|invalid_request_error|model not found|does not exist/;

/**
 * provider 오류를 체인이 다룰 수 있는 분류로 바꾼다.
 *
 * provider 마다 오류를 담는 형식이 다르다 — 상태 코드가 객체 필드로 오기도 하고,
 * 메시지 앞에 숫자로 붙기도 하고(OpenAI SDK), 본문 JSON 안에 `"code": 400` 으로
 * 들어 있기도 하다(Google). 그래서 값과 문자열을 함께 본다.
 *
 * 어디에도 안 걸리면 일시적인 고장으로 보고 다음 provider 로 넘긴다 — 아는 오류만
 * 재시도하면 모르는 고장에서 리뷰가 통째로 멈춘다.
 */
export function classifyError(error: unknown): ErrorClass {
	if (error instanceof SchemaViolationError) return "schema-violation";
	if (
		error instanceof SplitRequiredError ||
		error instanceof OutputTruncatedError
	)
		return "split-batch";

	const detail = error instanceof LlmError ? error.detail : undefined;
	const text = `${detail ?? ""} ${messageOf(error)}`.toLowerCase();
	const status = statusOf(error, text);

	// 한도 소진은 429 와 함께 오기도 한다 — 더 좁은 조건을 먼저 본다
	if (QUOTA.test(text)) return "cooldown-quota";
	if (status === 429 || RATE_LIMIT.test(text)) return "cooldown-rate-limit";
	// 컨텍스트 초과는 400 으로 오므로 인증 실패보다 먼저 걸러야 한다
	if (TOO_LARGE.test(text)) return "split-batch";
	if (status === 401 || status === 403 || status === 400) return "fail-fast";
	if (FAIL_FAST.test(text)) return "fail-fast";

	return "cooldown-server";
}

function messageOf(error: unknown): string {
	if (error instanceof Error) {
		const cause = (error as { cause?: unknown }).cause;
		const causeText = cause instanceof Error ? ` ${cause.message}` : "";
		return `${error.message}${causeText}`;
	}
	return String(error);
}

/** 본문 어디서나 숫자를 줍지 않는다 — 토큰 수나 모델 이름을 상태 코드로 읽지 않으려는 것이다 */
const STATUS_PATTERNS = [
	/^\s*(\d{3})\b/, // OpenAI SDK: "429 Rate limit ..."
	/"(?:code|status|status_code)"\s*:\s*(\d{3})/, // 본문 JSON 에 실려 오는 경우
	/\((\d{3})\)/, // Mistral: "Mistral API error (401): ..."
	/\b(?:http|status(?: code)?)\s*[:= ]\s*(\d{3})\b/,
];

function statusOf(error: unknown, text: string): number | undefined {
	if (typeof error === "object" && error !== null) {
		const record = error as Record<string, unknown>;
		for (const key of ["status", "statusCode", "code"]) {
			const value = record[key];
			if (typeof value === "number" && value >= 400 && value <= 599)
				return value;
		}
	}
	for (const pattern of STATUS_PATTERNS) {
		const matched = pattern.exec(text)?.[1];
		const parsed = matched ? Number(matched) : Number.NaN;
		if (parsed >= 400 && parsed <= 599) return parsed;
	}
	return undefined;
}
