import type { Redis } from "ioredis";
import type { CooldownStore } from "@/core/ports/cooldown";
import { log } from "@/core/ports/logger";
import { cooldownKey } from "./consts/keys";

/**
 * provider cooldown 을 Redis 에 담는 구현.
 *
 * TTL 이 곧 쉬는 시간이라 만료를 따로 관리하지 않는다. 재기동해도 남아 있어야 한다 —
 * 일일 한도를 소진한 provider 를 프로세스가 뜰 때마다 다시 때리면 안 된다.
 *
 * Redis 가 흔들려도 리뷰는 굴러가야 하므로 읽기 실패는 "쉬지 않는 중"으로 본다 —
 * 최악의 경우 429 를 한 번 더 받고 다음 provider 로 넘어간다.
 */
export function createRedisCooldowns(redis: Redis): CooldownStore {
	return {
		async active(provider: string): Promise<string | undefined> {
			try {
				return (await redis.get(cooldownKey(provider))) ?? undefined;
			} catch (error) {
				log.warn(`cooldown 조회 실패(무시): ${provider} — ${String(error)}`, {
					provider,
				});
				return undefined;
			}
		},

		async set(provider: string, reason: string, ttlMs: number): Promise<void> {
			try {
				await redis.set(cooldownKey(provider), reason, "PX", ttlMs);
				log.warn(`${provider} 를 ${Math.round(ttlMs / 1000)}초 쉬게 한다`, {
					provider,
					reason,
					cooldownMs: ttlMs,
				});
			} catch (error) {
				log.warn(`cooldown 기록 실패(무시): ${provider} — ${String(error)}`, {
					provider,
				});
			}
		},
	};
}
