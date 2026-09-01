import type { CooldownStore } from "@/core/ports/cooldown";
import { noCooldown } from "@/core/ports/cooldown";
import { log } from "@/core/ports/logger";
import { classifyError } from "../lib/classify-error";
import type { LlmClient } from "./client";
import {
	ChainExhaustedError,
	describeProvider,
	SplitRequiredError,
} from "./errors";
import type { CooldownPolicy, ErrorClass, ProviderSpec } from "./provider";
import { cooldownMs, DEFAULT_COOLDOWN } from "./provider";
import type { TokenUsage } from "./types";

export interface ProviderRuntime {
	spec: ProviderSpec;
	client: LlmClient;
}

export interface ChainDeps {
	/** 시도 순서대로 정렬된 provider 들 */
	providers: ProviderRuntime[];
	cooldowns?: CooldownStore;
	cooldown?: CooldownPolicy;
}

/**
 * 고정 순위로 provider 를 돌며 한 번의 작업을 성사시키는 체인.
 *
 * 전환은 배치 단위다 — 한 배치를 맡은 provider 가 도구 루프를 끝까지 돌아야 대화의
 * 앞뒤가 맞기 때문에, 도중에 갈아타지 않고 배치째로 다음 provider 에게 넘긴다.
 */
export interface ProviderChain {
	/** 체인 전체에서 누적된 토큰 사용량 */
	readonly totalUsage: TokenUsage;
	/** 1순위 provider 의 프롬프트 예산 — 배치를 이 크기로 묶는다 */
	readonly promptBudget: number;
	/**
	 * 일감 하나를 성사시킨다.
	 *
	 * `promptChars` 는 이번 일감이 실어보낼 대략의 크기다 — 이보다 예산이 작은
	 * provider 는 부르지 않고 건너뛴다. 아무도 못 받으면 `SplitRequiredError` 를
	 * 던져 부른 쪽이 배치를 쪼개게 한다.
	 */
	run<T>(
		promptChars: number,
		job: (client: LlmClient, spec: ProviderSpec) => Promise<T>,
	): Promise<T>;
}

export function createProviderChain(deps: ChainDeps): ProviderChain {
	const { providers } = deps;
	const cooldowns = deps.cooldowns ?? noCooldown;
	const policy = deps.cooldown ?? DEFAULT_COOLDOWN;
	// 인증 실패처럼 다시 불러도 같은 결과가 나올 provider 는 이번 잡에서 빼둔다.
	// cooldown 과 달리 프로세스 밖으로 나가지 않는다 — 키를 고치면 다음 잡부터 다시 쓴다.
	const excluded = new Set<string>();

	return {
		promptBudget: providers[0]?.spec.maxPromptChars ?? 0,

		get totalUsage(): TokenUsage {
			return providers.reduce<TokenUsage>(
				(sum, { client }) => ({
					prompt_tokens: sum.prompt_tokens + client.totalUsage.prompt_tokens,
					completion_tokens:
						sum.completion_tokens + client.totalUsage.completion_tokens,
					total_tokens: sum.total_tokens + client.totalUsage.total_tokens,
				}),
				{ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
			);
		},

		async run<T>(
			promptChars: number,
			job: (client: LlmClient, spec: ProviderSpec) => Promise<T>,
		): Promise<T> {
			const attempts: Array<{ provider: string; errorClass: ErrorClass }> = [];
			let tooLarge = 0;

			for (const { spec, client } of providers) {
				if (excluded.has(spec.name)) continue;

				const cooling = await cooldowns.active(spec.name);
				if (cooling) {
					log.info(`${spec.name} 은 쉬는 중이라 건너뛴다`, {
						provider: spec.name,
						reason: cooling,
					});
					continue;
				}

				if (promptChars > spec.maxPromptChars) {
					tooLarge++;
					log.info(`${spec.name} 예산을 넘어 건너뛴다`, {
						provider: spec.name,
						promptChars,
						budget: spec.maxPromptChars,
					});
					continue;
				}

				try {
					return await job(client, spec);
				} catch (error) {
					const errorClass = classifyError(error);
					attempts.push({ provider: spec.name, errorClass });
					const message =
						error instanceof Error ? error.message : String(error);

					// 규격을 어긴 응답은 우회하지 않는다 — 다른 provider 로 넘기지도 않는다
					if (errorClass === "schema-violation") throw error;

					// 크기 문제는 provider 를 바꿔도 그대로다. 쪼개서 다시 오라고 알린다
					if (errorClass === "split-batch")
						throw new SplitRequiredError(
							`${describeProvider(spec)}: 프롬프트가 들어가지 않는다 — ${message}`,
						);

					log.warn(`${describeProvider(spec)} 실패 — ${message}`, {
						provider: spec.name,
						model: spec.model,
						errorClass,
					});

					if (errorClass === "fail-fast") {
						excluded.add(spec.name);
						continue;
					}

					const ttl = cooldownMs(policy, errorClass);
					if (ttl !== undefined)
						await cooldowns.set(spec.name, errorClass, ttl);
				}
			}

			// 크기 때문에 못 부른 provider 만 남았다면 그것은 실패가 아니라 쪼갤 신호다
			if (attempts.length === 0 && tooLarge > 0)
				throw new SplitRequiredError(
					`프롬프트 ${promptChars}자가 남은 provider ${tooLarge}곳의 예산을 모두 넘는다`,
				);

			throw new ChainExhaustedError(
				attempts.length
					? `provider ${attempts.length}곳이 모두 실패했다 — ${attempts
							.map((a) => `${a.provider}:${a.errorClass}`)
							.join(", ")}`
					: "쓸 수 있는 provider 가 없다 (모두 쉬는 중이거나 이번 잡에서 제외됐다)",
				attempts,
			);
		},
	};
}
