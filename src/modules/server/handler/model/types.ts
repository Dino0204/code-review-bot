import type { BotConfig } from "@/core/config/model/bot-config";
import type { ReviewState } from "@/core/ports/review-state";
import type { GitHubApp } from "@/modules/github/app/model/types";
import type { QueueJob } from "../../queue/model/review-job";

export interface HandlerDeps {
	app: GitHubApp;
	gsmlApiKey: string;
	/** 리포지토리 설정 위에 얹을 값 — 환경변수에서 온다 */
	repoOverrides: Partial<BotConfig>;
	/** 어디까지 리뷰했는지 남겨두는 저장소 */
	state: ReviewState;
}

export interface AcceptedEvent {
	/** 큐에서 같은 PR의 중복 작업을 걸러내는 키 */
	key: string;
	/** 큐에 실릴 작업. 클로저가 아니라 데이터다 — Redis 를 거치며 직렬화된다 */
	job: QueueJob;
	/** 0보다 크면 그만큼 미뤘다 실행한다 — 연달아 오는 푸시를 묶는다 */
	delayMs?: number;
}

/** 봇이 이 트리거에 대해 할 일 */
export type Intent = { kind: "review" } | { kind: "reply"; commentId: number };
