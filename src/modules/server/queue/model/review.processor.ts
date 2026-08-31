import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { log } from "@/core/ports/logger";
import { HandlerService } from "../../handler/handler.service";
import { REVIEW_CONCURRENCY, REVIEW_QUEUE } from "../consts/queue";
import { parseQueueJob } from "./review-job";

/**
 * 큐에서 잡을 꺼내 실제 리뷰를 돌리는 워커.
 *
 * 웹훅 프로세스와 같은 프로세스에서 돈다 — 리뷰가 몇 분씩 걸려도 HTTP 응답은
 * 이미 나간 뒤라 서로를 막지 않는다. 나중에 워커만 따로 띄우고 싶으면 이 클래스를
 * 별도 진입점에 올리면 된다.
 */
@Processor(REVIEW_QUEUE, { concurrency: REVIEW_CONCURRENCY })
export class ReviewProcessor extends WorkerHost {
	constructor(private readonly handler: HandlerService) {
		super();
	}

	override async process(job: Job<unknown>): Promise<void> {
		// attemptsMade 는 이번 시도를 세기 전 값이다 — +1 해야 지금이 몇 번째인지가 된다
		const attempts = job.opts.attempts ?? 1;
		await this.handler.run(
			parseQueueJob(job.data),
			job.attemptsMade + 1 >= attempts,
		);
	}

	@OnWorkerEvent("completed")
	onCompleted(job: Job): void {
		const seconds = job.finishedOn
			? Math.round(
					(job.finishedOn - (job.processedOn ?? job.finishedOn)) / 1000,
				)
			: 0;
		log.info(`큐: ${job.name} 완료 (${seconds}초)`);
	}

	@OnWorkerEvent("failed")
	onFailed(job: Job | undefined, error: Error): void {
		// 잡 하나가 실패해도 워커는 계속 돈다
		const attempts = job?.opts.attempts ?? 1;
		const made = job?.attemptsMade ?? 1;
		const retrying =
			made < attempts ? ` — ${made}/${attempts}, 다시 시도한다` : "";
		log.error(
			`큐: ${job?.name ?? "(알 수 없는 잡)"} 실패${retrying} — ${error.message}`,
		);
	}

	@OnWorkerEvent("error")
	onError(error: Error): void {
		// Redis 연결이 끊기는 등 잡과 무관한 오류
		log.error(`큐 오류: ${error.message}`);
	}
}
