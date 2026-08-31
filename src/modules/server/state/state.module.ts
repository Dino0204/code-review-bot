import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import { log } from "@/core/ports/logger";
import type { ReviewState } from "@/core/ports/review-state";
import { createRedisReviewState } from "@/modules/state/redis-review-state";
import { type ServerConfig, serverConfig } from "../config/model/server-config";
import { REDIS_CLIENT, REVIEW_STATE } from "./consts/tokens";

/**
 * 리뷰 상태 저장소를 꽂는 자리.
 *
 * 큐(BullMQ)와 같은 Redis 를 쓰지만 연결은 따로 잡는다 — 큐 워커는 블로킹 명령으로
 * 연결을 붙잡고 있어서, 같은 연결로 상태를 읽으면 서로를 기다리게 된다.
 */
@Module({
	providers: [
		{
			provide: REDIS_CLIENT,
			inject: [serverConfig.KEY],
			useFactory: (config: ServerConfig) => new Redis(config.redisUrl),
		},
		{
			provide: REVIEW_STATE,
			inject: [REDIS_CLIENT],
			useFactory: (redis: Redis): ReviewState => createRedisReviewState(redis),
		},
	],
	exports: [REVIEW_STATE],
})
export class StateModule implements OnApplicationShutdown {
	constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

	async onApplicationShutdown(): Promise<void> {
		// 남은 명령을 흘려보내고 닫는다 — 마커를 쓰는 도중이면 그것까지 끝난 뒤다
		await this.redis.quit().catch((error: unknown) => {
			log.warn(`Redis 연결을 닫지 못했다 — ${String(error)}`);
		});
	}
}
