import type { BotConfig } from "@/core/config/model/bot-config";
import type { GitHubClient } from "@/core/github/port";
import type { ProviderChain } from "@/core/llm/model/chain";
import type { LlmClient } from "@/core/llm/model/client";
import type { RepoInstructions } from "@/core/review/prompt/model/types";

export interface ThreadDeps {
	github: GitHubClient;
	/** 답변 한 번을 성사시킬 provider 체인 */
	chain: ProviderChain;
	config: BotConfig;
	/** 리포지토리 지침 문서. 없는 리포지토리도 있으므로 선택 사항이다 */
	instructions?: RepoInstructions;
}

/** 체인이 고른 provider 하나 위에서 도는 답변 요청의 의존 */
export interface ReplyDeps {
	llm: LlmClient;
	config: BotConfig;
}

export interface ThreadOutcome {
	replied: boolean;
	/** 도구 호출을 받지 못해 모델 본문을 그대로 실은 경우 */
	degraded: boolean;
}
