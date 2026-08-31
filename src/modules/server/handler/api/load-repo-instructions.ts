import { INSTRUCTION_FILES } from "@/core/config/consts/files";
import type { GitHubClient } from "@/core/github/port";
import { log } from "@/core/ports/logger";
import type { RepoInstructions } from "@/core/review/prompt/model/types";

/**
 * 리포지토리의 코딩 지침 문서를 API로 읽는다. 후보 중 먼저 발견된 하나만 쓴다.
 *
 * 설정 파일과 같은 ref(PR의 head)에서 읽는다 — 지침을 고치는 PR에서 새 지침이
 * 그 PR 리뷰에 바로 반영된다.
 */
export async function loadRepoInstructions(
	github: GitHubClient,
	ref: string,
): Promise<RepoInstructions | undefined> {
	for (const candidate of INSTRUCTION_FILES) {
		const raw = await github.readFile(candidate, ref);
		if (raw?.trim()) {
			log.info(`리포지토리 지침 로드: ${candidate} (${raw.length}자)`);
			return { path: candidate, content: raw };
		}
	}
	log.debug(`리포지토리 지침 없음 (${INSTRUCTION_FILES.join(", ")})`);
	return undefined;
}
