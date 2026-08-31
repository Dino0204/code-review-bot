import { Inject, Injectable } from "@nestjs/common";
import type { RawEvent } from "@/core/event/model/types";
import { createGitHubApp } from "@/modules/github/app/api/create-github-app";
import { SERVER_ENV, type ServerEnv } from "../config/model/server-env";
import { accept } from "./model/accept";
import type { AcceptedEvent, HandlerDeps } from "./model/types";

/**
 * 웹훅 판정에 필요한 의존을 한 번만 만들어 들고 있는다.
 *
 * App 인증 클라이언트는 설치 토큰을 캐시하므로 요청마다 새로 만들면 안 된다.
 */
@Injectable()
export class HandlerService {
	private readonly deps: HandlerDeps;

	constructor(@Inject(SERVER_ENV) env: ServerEnv) {
		this.deps = {
			app: createGitHubApp({
				appId: env.githubAppId,
				privateKey: env.githubPrivateKey,
			}),
			gsmlApiKey: env.gsmlApiKey,
		};
	}

	accept(eventName: string, payload: RawEvent): AcceptedEvent | undefined {
		return accept(this.deps, eventName, payload);
	}
}
