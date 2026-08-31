import { CONFIG_FILES } from "@/core/config/consts/files";
import type { BotConfig } from "@/core/config/model/bot-config";
import { loadConfig } from "@/core/config/model/load-config";
import type { GitHubClient } from "@/core/github/port";
import { log } from "@/core/ports/logger";

/** 리포지토리의 설정 파일을 API로 읽는다. 후보 중 먼저 발견된 하나만 쓴다. */
export async function loadRepoConfig(
	github: GitHubClient,
	ref: string,
	overrides: Partial<BotConfig>,
): Promise<BotConfig> {
	for (const candidate of CONFIG_FILES) {
		const raw = await github.readFile(candidate, ref);
		if (raw !== undefined) {
			log.info(`설정 파일 로드: ${candidate}`);
			return loadConfig(raw, overrides);
		}
	}
	return loadConfig(undefined, overrides);
}
