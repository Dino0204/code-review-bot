import { parse as parseYaml } from "yaml";
import { log } from "../../logger";
import { DEFAULT_CONFIG } from "../consts/defaults";
import { envOverrides } from "../lib/env-overrides";
import { pickRepoConfig } from "../lib/pick-repo-config";
import type { BotConfig } from "./bot-config";

/**
 * 설정 병합 순서: 기본값 → 설정 파일 최상위 → 설정 파일의 이 봇 네임스페이스 → 환경변수
 *
 * 설정 파일 내용은 호출부가 GitHub API로 읽어 넘긴다 — 리포지토리를 체크아웃하지 않는다.
 */
export function loadConfig(fileContent?: string): BotConfig {
	let fromFile: Partial<BotConfig> = {};
	if (fileContent !== undefined) {
		try {
			fromFile = pickRepoConfig(parseYaml(fileContent));
		} catch (error) {
			log.warn(
				`설정 파일 파싱 실패: ${(error as Error).message} — 기본값을 사용한다`,
			);
		}
	}

	return { ...DEFAULT_CONFIG, ...fromFile, ...envOverrides() };
}
