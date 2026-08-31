import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { serverConfig } from "./config/model/server-config";
import { HealthModule } from "./health/health.module";
import { WebhookModule } from "./webhook/webhook.module";

/** 루트 모듈. 큐·핸들러는 웹훅과 헬스체크가 각자 import 한다 */
@Module({
	imports: [
		// 설정은 어느 모듈에서나 필요하다 — 전역으로 두고 import 를 되풀이하지 않는다
		ConfigModule.forRoot({ isGlobal: true, cache: true, load: [serverConfig] }),
		WebhookModule,
		HealthModule,
	],
})
export class AppModule {}
