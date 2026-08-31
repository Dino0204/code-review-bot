/**
 * provider 를 잠시 쉬게 하는 저장소.
 *
 * 429 나 한도 소진은 프로세스가 죽었다 살아나도 그대로다 — 메모리에 두면 재기동마다
 * 같은 provider 를 다시 때린다. 그래서 큐·마커와 같은 Redis 에 남긴다.
 * core 는 이 포트만 알고, 어디에 어떻게 담을지는 modules 가 정한다.
 */
export interface CooldownStore {
	/** 쉬는 중이면 그 사유, 아니면 undefined */
	active(provider: string): Promise<string | undefined>;
	set(provider: string, reason: string, ttlMs: number): Promise<void>;
}

/** 쉬게 하지 않는 구현 — 저장소를 안 꽂았을 때의 기본값이다 */
export const noCooldown: CooldownStore = {
	active: async () => undefined,
	set: async () => {},
};
