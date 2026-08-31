import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { HealthModule } from "./health/health.module";
import { WebhookModule } from "./webhook/webhook.module";

/** 루트 모듈. 큐·핸들러는 웹훅과 헬스체크가 각자 import 한다 */
@Module({
	imports: [ConfigModule, WebhookModule, HealthModule],
})
export class AppModule {}
