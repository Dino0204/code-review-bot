import { Controller, Get } from "@nestjs/common";
import { ReviewQueueService } from "../../queue/model/review-queue.service";

interface HealthStatus {
	ok: boolean;
	queued: number;
	active: string | null;
}

/**
 * 도커 헬스체크와 사람이 눈으로 확인하는 자리.
 *
 * 큐 상태를 같이 내보낸다 — 리뷰가 오래 걸릴 때 봇이 멈춘 것인지 밀린 것인지 구분된다.
 */
@Controller()
export class HealthController {
	constructor(private readonly queue: ReviewQueueService) {}

	@Get()
	root(): HealthStatus {
		return this.status();
	}

	@Get("health")
	health(): HealthStatus {
		return this.status();
	}

	private status(): HealthStatus {
		return {
			ok: true,
			queued: this.queue.size,
			active: this.queue.active ?? null,
		};
	}
}
