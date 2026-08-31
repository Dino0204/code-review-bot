import { Inject, Injectable } from "@nestjs/common";
import type { RawEvent } from "@/core/event/model/types";
import { createGitHubApp } from "@/modules/github/app/api/create-github-app";
import { type ServerConfig, serverConfig } from "../config/model/server-config";
import type { ReviewJob } from "../queue/model/review-job";
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

	constructor(@Inject(serverConfig.KEY) config: ServerConfig) {
		this.deps = {
			app: createGitHubApp({
				appId: config.githubAppId,
				privateKey: config.githubPrivateKey,
			}),
			gsmlApiKey: config.gsmlApiKey,
			repoOverrides: config.repoOverrides,
		};
	}

	/** 웹훅이 부른다 — API 를 건드리지 않고 페이로드만 보고 큐에 넣을지 정한다 */
	accept(eventName: string, payload: RawEvent): AcceptedEvent | undefined {
		return accept(eventName, payload);
	}

	/** 큐 워커가 부른다 — 실제 리뷰가 여기서 돈다 */
	run(job: ReviewJob): Promise<void> {
		return execute(
			this.deps,
			job.owner,
			job.repo,
			job.installationId,
			job.trigger,
		);
	}
}
