import { Inject, Injectable } from "@nestjs/common";
import type { RawEvent } from "@/core/event/model/types";
import { log } from "@/core/ports/logger";
import type { ReviewState } from "@/core/ports/review-state";
import { createGitHubApp } from "@/modules/github/app/api/create-github-app";
import { type ServerConfig, serverConfig } from "../config/model/server-config";
import { ChainFactory } from "../llm/model/chain.factory";
import type { QueueJob } from "../queue/model/review-job";
import { REVIEW_STATE } from "../state/consts/tokens";
import { accept } from "./model/accept";
import { execute } from "./model/execute";
import type { AcceptedEvent, HandlerDeps } from "./model/types";

/**
 * 웹훅 판정에 필요한 의존을 한 번만 만들어 들고 있는다.
 *
 * App 인증 클라이언트는 설치 토큰을 캐시하므로 요청마다 새로 만들면 안 된다.
 */
@Injectable()
export class HandlerService {
	private readonly deps: HandlerDeps;

	constructor(
		@Inject(serverConfig.KEY) config: ServerConfig,
		@Inject(REVIEW_STATE) private readonly state: ReviewState,
		chains: ChainFactory,
	) {
		this.deps = {
			app: createGitHubApp({
				appId: config.githubAppId,
				privateKey: config.githubPrivateKey,
			}),
			newChain: () => chains.create(),
			repoOverrides: config.repoOverrides,
			state,
		};
	}

	/** 웹훅이 부른다 — API 를 건드리지 않고 페이로드만 보고 큐에 넣을지 정한다 */
	accept(eventName: string, payload: RawEvent): AcceptedEvent | undefined {
		return accept(eventName, payload);
	}

	/** 큐 워커가 부른다 — 실제 리뷰가 여기서 돈다 */
	async run(job: QueueJob, lastAttempt: boolean): Promise<void> {
		if (job.kind === "cleanup") {
			await this.state.clear(job);
			log.info(`${job.owner}/${job.repo}#${job.pr} 닫힘 — 리뷰 상태를 지웠다`);
			return;
		}
		await execute(
			this.deps,
			job.owner,
			job.repo,
			job.installationId,
			job.trigger,
			lastAttempt,
		);
	}
}
