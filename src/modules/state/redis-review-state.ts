import type { Redis } from "ioredis";
import type { PrRef, ReviewState } from "@/core/ports/review-state";
import { allKeys, markerKey, STATE_TTL_SECONDS } from "./consts/keys";

/**
 * 리뷰 상태를 Redis 에 담는 구현.
 *
 * 마커는 Hash 하나에 파일 경로를 field 로 담는다 — 파일마다 키를 따로 두면
 * PR 을 지울 때 키를 훑어야 하고, 한 번에 읽어오지도 못한다.
 */
export function createRedisReviewState(redis: Redis): ReviewState {
	return {
		async markers(ref: PrRef): Promise<Map<string, string>> {
			const stored = await redis.hgetall(markerKey(ref));
			return new Map(Object.entries(stored));
		},

		async saveMarkers(ref: PrRef, hashes: Map<string, string>): Promise<void> {
			if (hashes.size === 0) return;
			const key = markerKey(ref);
			// 쓰기와 TTL 갱신이 갈라지면 안 된다 — 사이에 죽으면 TTL 없는 키가 남는다
			await redis
				.multi()
				.hset(key, Object.fromEntries(hashes))
				.expire(key, STATE_TTL_SECONDS)
				.exec();
		},

		async clear(ref: PrRef): Promise<void> {
			await redis.del(...allKeys(ref));
		},
	};
}
