import type { ErrorClass, ProviderSpec } from "./provider";

export class LlmError extends Error {
	/**
	 * provider 가 준 원문.
	 *
	 * 우리가 앞에 붙인 설명 때문에 상태 코드가 문장 한가운데로 밀려나면 분류가 어긋난다 —
	 * 분류기는 이 원문을 먼저 본다.
	 */
	readonly detail?: string;

	constructor(message: string, detail?: string) {
		super(message);
		this.name = "LlmError";
		if (detail !== undefined) this.detail = detail;
	}
}

/**
 * 모델 응답이 스키마를 통과하지 못했다.
 *
 * 이 오류는 다른 provider 로 넘기지 않는다 — 모델이 규격을 지키게 하는 것이 클라이언트가
 * 덮는 것보다 낫다. 덮으면 틀린 줄 번호가 그대로 GitHub 까지 가서 422 가 된다.
 */
export class SchemaViolationError extends LlmError {
	constructor(message: string) {
		super(message);
		this.name = "SchemaViolationError";
	}
}

/**
 * 응답이 출력 상한에서 잘렸다.
 *
 * 도구 호출이 중간에서 끊기면 지적 하나가 통째로 사라지는데, 결과만 봐서는 모델이
 * 그만큼만 낸 것과 구분되지 않는다. 배치를 쪼개면 낼 지적도 줄어 상한 안에 들어온다.
 */
export class OutputTruncatedError extends LlmError {
	constructor(message: string) {
		super(message);
		this.name = "OutputTruncatedError";
	}
}

/** 프롬프트가 남은 provider 어디에도 안 들어간다 — 배치를 쪼개 다시 부르라는 신호다 */
export class SplitRequiredError extends LlmError {
	constructor(message: string) {
		super(message);
		this.name = "SplitRequiredError";
	}
}

/** 체인의 provider 를 다 돌았는데 아무도 응답하지 못했다 */
export class ChainExhaustedError extends LlmError {
	constructor(
		message: string,
		readonly attempts: Array<{ provider: string; errorClass: ErrorClass }>,
	) {
		super(message);
		this.name = "ChainExhaustedError";
	}
}

/** 로그에 provider 를 함께 남기기 위해 감싼다 — 원인은 `cause` 에 그대로 둔다 */
export function describeProvider(spec: ProviderSpec): string {
	return `${spec.name}(${spec.model})`;
}
