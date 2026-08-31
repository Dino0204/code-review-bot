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
	/** 고쳐 쓸 요약 코멘트 id. 없으면 새로 단다 */
	summaryCommentId?: number;
	/**
	 * 이미 리뷰한 파일의 해시. 주면 달라진 파일만 본다.
	 *
	 * 넘기지 않으면 전체를 다시 본다 — 사람이 `/review` 로 부른 경우가 그렇다.
	 * 저장소를 부르는 것은 modules 쪽이고 여기에는 값만 들어온다.
	 */
	markers?: Map<string, string>;
}

export interface GatheredContext {
	context: ReviewContext;
	skippedFiles: number;
	/** 지난 리뷰 이후 그대로라 이번에 안 보는 파일 수 */
	unchangedFiles: number;
	/** 이번에 리뷰할 파일의 새 마커 값 */
	hashes: Map<string, string>;
}

export interface ReviewOutcome {
	posted: boolean;
	findings: number;
	inline: number;
	/** 리뷰를 마친 파일의 마커 — 부른 쪽이 저장한다 */
	markers: Map<string, string>;
	/** 이번에 쓰거나 새로 단 요약 코멘트 id — 다음 리뷰가 이 자리를 고쳐 쓴다 */
	summaryCommentId?: number;
}
