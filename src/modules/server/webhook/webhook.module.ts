import { Module } from "@nestjs/common";
import { HandlerModule } from "../handler/handler.module";
import { QueueModule } from "../queue/queue.module";
import { WebhookController } from "./api/webhook.controller";
import { WebhookService } from "./model/webhook.service";

@Module({
	imports: [HandlerModule, QueueModule],
	controllers: [WebhookController],
	providers: [WebhookService],
})
export class WebhookModule {}
