import type { GitHubClient } from "@/core/github/port";
import { log } from "@/core/ports/logger";

/**
 * 요약을 PR 코멘트 하나에 모아 놓고 계속 고쳐 쓴다.
 *
 * 푸시마다 요약을 새로 달면 PR 대화가 봇 코멘트로 뒤덮인다. 한 자리를 잡아두고
 * 내용만 갈아끼우면 사람은 언제나 최신 요약 하나만 보게 된다.
 *
 * 코멘트 id 는 저장소에 남는다. 사람이 그 코멘트를 지웠으면 새로 달고 새 id 를 돌려준다.
 */
export async function upsertSummary(
	github: GitHubClient,
	prNumber: number,
	body: string,
	existingId: number | undefined,
): Promise<number> {
	if (existingId !== undefined) {
		const updated = await github.updateIssueComment(existingId, body);
		if (updated) {
			log.debug(`요약 코멘트 ${existingId} 갱신`);
			return existingId;
		}
	}
	return github.createIssueComment(prNumber, body);
}
