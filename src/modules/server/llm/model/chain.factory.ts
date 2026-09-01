import { Inject, Injectable } from "@nestjs/common";
import type { ProviderChain } from "@/core/llm/model/chain";
import { createProviderChain } from "@/core/llm/model/chain";
import type { ProviderChainConfig } from "@/core/llm/model/providers-file";
import type { CooldownStore } from "@/core/ports/cooldown";
import { log } from "@/core/ports/logger";
import { createLlmClient } from "@/modules/llm/client";
import {
	type ServerConfig,
	serverConfig,
} from "../../config/model/server-config";
import { COOLDOWNS } from "../../state/consts/tokens";
import { loadProviders } from "../api/load-providers";

/**
 * 리뷰 한 건마다 체인을 새로 만든다.
 *
 * 체인은 이번 잡에서 제외한 provider 와 누적 토큰을 들고 있어서, 나눠 쓰면 앞선 잡의
 * 사정이 다음 잡에 새어 든다. provider 정의와 cooldown 저장소는 부팅 때 한 번만 읽는다.
 */
@Injectable()
export class ChainFactory {
	private readonly config: ProviderChainConfig;

	constructor(
		@Inject(serverConfig.KEY) server: ServerConfig,
		@Inject(COOLDOWNS) private readonly cooldowns: CooldownStore,
	) {
		this.config = loadProviders(server.providersFile);
		log.info(
			`provider 체인 ${this.config.providers.length}곳 — ${this.config.providers
				.map((provider) => `${provider.name}:${provider.model}`)
				.join(" → ")}`,
			{ providers: this.config.providers.length },
		);
	}

	create(): ProviderChain {
		return createProviderChain({
			providers: this.config.providers.map((spec) => ({
				spec,
				client: createLlmClient(spec),
			})),
			cooldowns: this.cooldowns,
			cooldown: this.config.cooldown,
		});
	}
}
