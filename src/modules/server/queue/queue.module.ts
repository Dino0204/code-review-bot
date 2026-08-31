import { Module } from "@nestjs/common";
import { ReviewQueueService } from "./model/review-queue.service";

@Module({
	providers: [ReviewQueueService],
	exports: [ReviewQueueService],
})
export class QueueModule {}
