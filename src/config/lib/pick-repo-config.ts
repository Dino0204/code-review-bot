import { log } from "@/logger";
import { BOT_NAMESPACES } from "../consts/bot";
import type { BotConfig } from "../model/bot-config";
import { pickFileConfig } from "./pick-file-config";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 설정 파일 한 장에서 이 봇에 적용할 값을 뽑는다: 최상위 공통 설정 → 이 봇의 네임스페이스 블록.
 *
 * 네임스페이스 블록은 최상위와 같은 키를 그대로 쓴다 — 겹치는 키는 블록 쪽이 이긴다.
 * `exclude` 도 마찬가지로 덮어쓴다(기본 제외 목록 + 그 레이어의 목록). 누적하지 않는 것은
 * sandrone 쪽 동작과 맞추기 위해서다 — 같은 파일을 읽은 두 봇이 서로 다른 파일을 리뷰하면 안 된다.
 */
export function pickRepoConfig(raw: unknown): Partial<BotConfig> {
	let merged = pickFileConfig(raw);
	if (!isRecord(raw)) return merged;

	for (const namespace of BOT_NAMESPACES) {
		const block = raw[namespace];
		if (!isRecord(block)) continue;
		log.info(`설정 네임스페이스 적용: ${namespace}`);
		merged = { ...merged, ...pickFileConfig(block) };
	}

	// 다른 봇의 블록은 건너뛴다. 키 이름은 외부 입력이라 개수만 남긴다.
	const skipped = Object.keys(raw).filter(
		(key) =>
			isRecord(raw[key]) &&
			!(BOT_NAMESPACES as readonly string[]).includes(key),
	).length;
	if (skipped > 0)
		log.info(`다른 봇의 설정 네임스페이스 ${skipped}개를 건너뛰었다`);

	return merged;
}
