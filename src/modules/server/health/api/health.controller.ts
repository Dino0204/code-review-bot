import { Controller, Get } from "@nestjs/common";
import { log } from "@/core/ports/logger";
import { ReviewQueueService } from "../../queue/model/review-queue.service";

interface HealthStatus {
	/** 큐 상태를 읽어올 수 있는지 — Redis 가 끊기면 false 다 */
	ok: boolean;
	queued: number;
	active: number;
	failed: number;
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
	root(): Promise<HealthStatus> {
		return this.status();
	}

	@Get("health")
	health(): Promise<HealthStatus> {
		return this.status();
	}

	/**
	 * Redis 가 끊겨도 500 을 내지 않는다 — 스택 대신 `ok: false` 로 보이는 편이
	 * 도커 헬스체크와 사람 모두에게 읽기 쉽다.
	 */
	private async status(): Promise<HealthStatus> {
		try {
			const counts = await this.queue.status();
			return {
				ok: true,
				queued: counts.waiting,
				active: counts.active,
				failed: counts.failed,
			};
		} catch (error) {
			log.warn(
				`큐 상태를 읽지 못했다 — ${error instanceof Error ? error.message : String(error)}`,
			);
			return { ok: false, queued: 0, active: 0, failed: 0 };
		}
	}
}
