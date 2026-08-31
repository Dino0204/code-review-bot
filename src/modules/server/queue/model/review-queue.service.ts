import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { log } from "@/core/ports/logger";
import { createReviewQueue, type Job } from "./create-review-queue";

/**
 * 리뷰 큐를 DI 로 넘기기 위한 얇은 껍데기.
 *
 * 지금 구현은 프로세스 안의 인메모리 큐라 재기동하면 대기 중인 작업이 사라진다.
 * 5단계에서 BullMQ 로 갈아끼울 자리이며, 그때 이 클래스의 구현만 바뀌고
 * 부르는 쪽(웹훅·헬스체크)은 그대로 둔다.
 */
@Injectable()
export class ReviewQueueService implements OnApplicationShutdown {
	private readonly queue = createReviewQueue();

	get size(): number {
		return this.queue.size;
	}

	get active(): string | undefined {
		return this.queue.active;
	}

	enqueue(key: string, job: Job): void {
		this.queue.enqueue(key, job);
	}

	/**
	 * 종료 신호를 받으면 Nest 가 HTTP 서버를 먼저 닫는다 — 새 웹훅은 들어오지 않는다.
	 * 진행 중인 리뷰는 중단하지 않는다. 중간에 끊으면 그때까지 쓴 토큰이 버려진다.
	 */
	onApplicationShutdown(signal?: string): void {
		log.info(
			`${signal ?? "종료"} 수신 — 새 요청을 받지 않는다 (진행 중 리뷰 ${this.queue.size}건)`,
		);
	}
}
