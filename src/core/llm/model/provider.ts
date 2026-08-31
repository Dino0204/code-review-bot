/** pi-ai 가 이해하는 API surface 중 이 봇이 쓰는 것들 */
export type ProviderApi =
	| "openai-completions"
	| "google-generative-ai"
	| "mistral-conversations";

/**
 * 체인에 실릴 provider 하나의 정의.
 *
 * `providers.yml` 에서 오며 리포지토리 설정으로는 못 바꾼다 — 리포 주인이 운영자 키로
 * 임의 모델을 부르는 것을 막기 위해서다.
 */
export interface ProviderSpec {
	name: string;
	api: ProviderApi;
	/** provider 기본 엔드포인트를 쓰지 않을 때만 채운다 */
	baseUrl?: string;
	model: string;
	apiKey: string;
	/** 이 provider 에 한 번에 실어보낼 프롬프트 상한. 배치 예산이 된다 */
	maxPromptChars: number;
	timeoutMs: number;
	/** 모델이 아는 값과 다를 때만 채운다 — 비우면 pi-ai 레지스트리 값을 쓴다 */
	contextWindow?: number;
	maxOutputTokens?: number;
}

/** 오류를 어떻게 다룰지 정하는 분류. 체인은 이 값으로만 판단한다 */
export type ErrorClass =
	| "cooldown-rate-limit"
	| "cooldown-quota"
	| "cooldown-server"
	| "split-batch"
	| "fail-fast"
	| "schema-violation";

/** 분류별 cooldown 길이 */
export interface CooldownPolicy {
	rateLimitMs: number;
	quotaMs: number;
	serverErrorMs: number;
}

export const DEFAULT_COOLDOWN: CooldownPolicy = {
	rateLimitMs: 300_000,
	quotaMs: 3_600_000,
	serverErrorMs: 60_000,
};

export function cooldownMs(
	policy: CooldownPolicy,
	errorClass: ErrorClass,
): number | undefined {
	if (errorClass === "cooldown-rate-limit") return policy.rateLimitMs;
	if (errorClass === "cooldown-quota") return policy.quotaMs;
	if (errorClass === "cooldown-server") return policy.serverErrorMs;
	return undefined;
}
