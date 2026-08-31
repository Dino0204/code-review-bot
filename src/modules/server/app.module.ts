import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { REDIS_KEY_PREFIX } from "./config/consts/redis";
import { type ServerConfig, serverConfig } from "./config/model/server-config";
import { HealthModule } from "./health/health.module";
import { WebhookModule } from "./webhook/webhook.module";

/** 루트 모듈. 큐·핸들러는 웹훅과 헬스체크가 각자 import 한다 */
@Module({
	imports: [
		// 설정은 어느 모듈에서나 필요하다 — 전역으로 두고 import 를 되풀이하지 않는다
		ConfigModule.forRoot({ isGlobal: true, cache: true, load: [serverConfig] }),
		// 큐 연결은 한 곳에서만 정한다. 큐 자체는 QueueModule 이 registerQueue 로 받는다.
		BullModule.forRootAsync({
			inject: [serverConfig.KEY],
			useFactory: (config: ServerConfig) => ({
				connection: { url: config.redisUrl },
				// 봇이 쓰는 Redis 키를 `rb:` 아래로 모은다 — 남의 Redis 를 같이 써도 섞이지 않는다
				prefix: REDIS_KEY_PREFIX,
			}),
		}),
		WebhookModule,
		HealthModule,
	],
})
export class AppModule {}
