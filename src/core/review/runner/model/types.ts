import type { BotConfig } from "@/core/config/model/bot-config";
import type { GitHubClient } from "@/core/github/port";
import type { LlmClient } from "@/core/llm/model/client";
import type {
	RepoInstructions,
	ReviewContext,
} from "@/core/review/prompt/model/types";

export interface RunnerDeps {
	github: GitHubClient;
	llm: LlmClient;
	config: BotConfig;
	/** 리포지토리 지침 문서. 없는 리포지토리도 있으므로 선택 사항이다 */
	instructions?: RepoInstructions;
}

export interface GatheredContext {
	context: ReviewContext;
	skippedFiles: number;
}

export interface ReviewOutcome {
	posted: boolean;
	findings: number;
	inline: number;
}
