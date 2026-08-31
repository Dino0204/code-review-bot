import type { BotConfig } from "@/core/config/model/bot-config";
import type { GitHubApp } from "@/modules/github/app/model/types";

export interface HandlerDeps {
	app: GitHubApp;
	gsmlApiKey: string;
	/** 리포지토리 설정 위에 얹을 값 — 환경변수에서 온다 */
	repoOverrides: Partial<BotConfig>;
}

export interface AcceptedEvent {
	/** 큐에서 같은 PR의 중복 작업을 걸러내는 키 */
	key: string;
	run: () => Promise<void>;
}

/** 봇이 이 트리거에 대해 할 일 */
export type Intent = { kind: "review" } | { kind: "reply"; commentId: number };
