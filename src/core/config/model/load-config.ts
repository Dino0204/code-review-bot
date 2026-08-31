import { parse as parseYaml } from "yaml";
import { log } from "@/core/ports/logger";
import { DEFAULT_CONFIG } from "../consts/defaults";
import { pickRepoConfig } from "../lib/pick-repo-config";
import type { BotConfig } from "./bot-config";

/**
 * 설정 병합 순서: 기본값 → 설정 파일 최상위 → 설정 파일의 이 봇 네임스페이스 → 덮어쓸 값
 *
 * 설정 파일 내용은 호출부가 GitHub API로 읽어 넘긴다 — 리포지토리를 체크아웃하지 않는다.
 * 마지막에 얹을 값(환경변수 등)도 호출부가 만들어 넘긴다 — 어디서 온 값인지는 여기서 알 바가 아니다.
 */
export function loadConfig(
	fileContent?: string,
	overrides: Partial<BotConfig> = {},
): BotConfig {
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

	return { ...DEFAULT_CONFIG, ...fromFile, ...overrides };
}
