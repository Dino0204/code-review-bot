import { CONFIG_FILES } from "@/config/consts/files";
import type { BotConfig } from "@/config/model/bot-config";
import { loadConfig } from "@/config/model/load-config";
import type { GitHubClient } from "@/github/client/model/types";
import { log } from "@/logger";

/** 리포지토리의 설정 파일을 API로 읽는다. 후보 중 먼저 발견된 하나만 쓴다. */
export async function loadRepoConfig(
	github: GitHubClient,
	ref: string,
): Promise<BotConfig> {
	for (const candidate of CONFIG_FILES) {
		const raw = await github.readFile(candidate, ref);
		if (raw !== undefined) {
			log.info(`설정 파일 로드: ${candidate}`);
			return loadConfig(raw);
		}
	}
	return loadConfig();
}
