import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { Queue } from "bullmq";
import { log } from "@/core/ports/logger";
import { KEEP_COMPLETED, KEEP_FAILED, REVIEW_QUEUE } from "../consts/queue";
import type { ReviewJob } from "./review-job";

/** 헬스체크가 그대로 내보내는 큐 상태 */
export interface QueueStatus {
	waiting: number;
	active: number;
	failed: number;
}

/**
 * 리뷰 작업을 Redis 큐에 넣는 자리.
 *
 * 웹훅은 10초 안에 응답해야 하는데 리뷰는 몇 분씩 걸린다. 그래서 웹훅 핸들러는
 * 작업을 큐에 넣고 바로 응답하고, 실제 리뷰는 워커가 순차로 돈다.
 * 프로세스가 죽어도 잡은 Redis 에 남아 있어 재기동하면 이어서 처리된다.
 *
 * 같은 키(리포지토리+PR)의 중복은 BullMQ 의 deduplication 으로 걸러낸다.
 * `replace` 는 아직 지연 상태인 잡을 새 잡으로 갈아치우고(= 디바운스 연장),
 * `keepLastIfActive` 는 이미 실행 중이면 마지막 요청 하나만 뒤에 세워둔다 —
 * 진행 중인 리뷰를 중단하지 않으면서도 최신 상태를 한 번 더 보게 된다.
 */
@Injectable()
export class ReviewQueueService implements OnApplicationShutdown {
	constructor(
		@InjectQueue(REVIEW_QUEUE) private readonly queue: Queue<ReviewJob>,
	) {}

	/** `delayMs` 를 주면 그만큼 미룬다 — 연달아 들어오는 푸시를 묶는 데 쓴다 */
	async enqueue(key: string, job: ReviewJob, delayMs = 0): Promise<void> {
		await this.queue.add(key, job, {
			deduplication: { id: key, replace: true, keepLastIfActive: true },
			delay: delayMs,
			removeOnComplete: KEEP_COMPLETED,
			removeOnFail: KEEP_FAILED,
		});
		log.info(
			`큐: ${key} 추가${delayMs ? ` (${Math.round(delayMs / 1000)}초 뒤 실행)` : ""}`,
		);
	}

	async status(): Promise<QueueStatus> {
		const counts = await this.queue.getJobCounts(
			"waiting",
			"delayed",
			"active",
			"failed",
		);
		return {
			waiting: (counts.waiting ?? 0) + (counts.delayed ?? 0),
			active: counts.active ?? 0,
			failed: counts.failed ?? 0,
		};
	}

	/**
	 * 종료 신호를 받으면 Nest 가 HTTP 서버를 먼저 닫는다 — 새 웹훅은 들어오지 않는다.
	 * 진행 중인 리뷰는 중단하지 않는다. 중간에 끊으면 그때까지 쓴 토큰이 버려지고,
	 * 잡은 Redis 에 남아 있으므로 재기동하면 다시 잡힌다.
	 */
	onApplicationShutdown(signal?: string): void {
		log.info(`${signal ?? "종료"} 수신 — 새 요청을 받지 않는다`);
	}
}
