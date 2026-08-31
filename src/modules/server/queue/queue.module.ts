import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { HandlerModule } from "../handler/handler.module";
import { REVIEW_QUEUE } from "./consts/queue";
import { ReviewProcessor } from "./model/review.processor";
import { ReviewQueueService } from "./model/review-queue.service";

@Module({
	imports: [BullModule.registerQueue({ name: REVIEW_QUEUE }), HandlerModule],
	providers: [ReviewQueueService, ReviewProcessor],
	exports: [ReviewQueueService],
})
export class QueueModule {}
