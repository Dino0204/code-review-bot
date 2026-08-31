import { log } from "@/logger";

/**
 * 리뷰 작업을 한 번에 하나씩 처리하는 큐.
 *
 * 웹훅은 10초 안에 응답해야 하는데 리뷰는 몇 분씩 걸린다. 그래서 웹훅 핸들러는
 * 작업을 큐에 넣고 바로 응답하고, 실제 리뷰는 여기서 순차로 돈다.
 *
 * 동시 실행이 1인 이유는 모델 서버가 슬롯을 하나만 주기 때문이다.
 * 병렬로 보내봐야 서로를 밀어낼 뿐이다.
 *
 * 같은 키(리포지토리+PR)의 **대기 중** 작업은 새 작업이 밀어낸다 —
 * 한 PR에 커밋을 연달아 밀면 마지막 상태만 리뷰하면 된다.
 * 이미 시작된 작업은 중단하지 않는다. 중간에 끊으면 모델 슬롯만 낭비하고,
 * 그때까지 쓴 토큰도 버려지기 때문이다.
 */
export type Job = () => Promise<void>;

interface Pending {
	key: string;
	job: Job;
}

export interface ReviewQueue {
	readonly size: number;
	readonly active: string | undefined;
	enqueue(key: string, job: Job): void;
}

export function createReviewQueue(): ReviewQueue {
	const pending: Pending[] = [];
	let running = false;
	/** 지금 처리 중인 작업의 키 — 중복 판정에는 쓰지 않고 로그·상태 확인용이다 */
	let activeKey: string | undefined;

	async function drain(): Promise<void> {
		if (running) return;
		running = true;

		while (pending.length > 0) {
			const entry = pending.shift();
			if (!entry) break;
			activeKey = entry.key;
			const started = Date.now();
			try {
				await entry.job();
				log.info(
					`큐: ${entry.key} 완료 (${Math.round((Date.now() - started) / 1000)}초)`,
				);
			} catch (error) {
				// 작업 하나가 실패해도 큐는 계속 돌아야 한다
				log.error(
					`큐: ${entry.key} 실패 — ${error instanceof Error ? error.message : String(error)}`,
				);
			} finally {
				activeKey = undefined;
			}
		}

		running = false;
	}

	return {
		get size(): number {
			return pending.length + (running ? 1 : 0);
		},
		get active(): string | undefined {
			return activeKey;
		},
		enqueue(key: string, job: Job): void {
			const replacedAt = pending.findIndex((entry) => entry.key === key);
			if (replacedAt !== -1) {
				pending[replacedAt] = { key, job };
				log.info(
					`큐: ${key} 대기 작업을 새 요청으로 교체했다 (대기 ${pending.length}건)`,
				);
			} else {
				pending.push({ key, job });
				log.info(`큐: ${key} 추가 (대기 ${pending.length}건)`);
			}
			void drain();
		},
	};
}
