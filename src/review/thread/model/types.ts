import type { BotConfig } from "@/config/model/bot-config";
import type { GitHubClient } from "@/github/client/model/types";
import type { LlmClient } from "@/llm/api/client";
import type { RepoInstructions } from "@/review/prompt/model/types";

export interface ThreadDeps {
	github: GitHubClient;
	llm: LlmClient;
	config: BotConfig;
	/** 리포지토리 지침 문서. 없는 리포지토리도 있으므로 선택 사항이다 */
	instructions?: RepoInstructions;
}

export interface ThreadOutcome {
	replied: boolean;
	/** 도구 호출을 받지 못해 모델 본문을 그대로 실은 경우 */
	degraded: boolean;
}
