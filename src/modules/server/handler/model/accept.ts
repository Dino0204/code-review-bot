import { BOT_MENTION } from "@/core/config/consts/bot";
import { isBotActor } from "@/core/event/lib/actor";
import { parseTrigger } from "@/core/event/lib/parse-trigger";
import { repoRefFrom } from "@/core/event/lib/repo-ref-from";
import type { RawEvent, Trigger } from "@/core/event/model/types";
import { log } from "@/core/ports/logger";
import { hasMention } from "@/core/review/commands/lib/has-mention";
import {
	AUTO_REVIEW_PR_ACTIONS,
	CLEANUP_PR_ACTIONS,
	PUSH_DEBOUNCE_MS,
} from "../consts/auto-review-actions";
import type { AcceptedEvent } from "./types";

/**
 * 큐에서 중복을 걸러내는 키.
 *
 * 리뷰는 PR 단위로 묶는다 — 커밋을 연달아 밀면 마지막 상태만 보면 된다.
 * 인라인 쓰레드는 코멘트 단위로 나눈다: 한 PR의 여러 쓰레드에서 동시에 봇을 부를 수 있고,
 * 그중 하나만 답하고 나머지를 버리면 사람이 부른 말이 조용히 사라진다.
 */
function queueKey(slug: string, trigger: Trigger): string {
	return trigger.kind === "review_comment"
		? `${slug}#${trigger.pr}@${trigger.commentId}`
		: `${slug}#${trigger.pr}`;
}

/**
 * 웹훅 이벤트가 리뷰를 돌릴 가치가 있는지 판단한다.
 *
 * 여기서는 API를 부르지 않고 페이로드만 본다 — 웹훅은 10초 안에 응답해야 하고,
 * 관심 없는 이벤트(일반 이슈 코멘트, 라벨 변경 …)가 대부분이기 때문이다.
 * 실제 명령 해석은 리포지토리 설정을 읽은 뒤에 한다.
 */
export function accept(
	eventName: string,
	payload: RawEvent,
): AcceptedEvent | undefined {
	const trigger = parseTrigger(eventName, payload);
	if (!trigger) return undefined;

	const repo = repoRefFrom(payload);
	if (!repo) return undefined;

	const installationId = payload.installation?.id;
	if (!installationId) {
		log.warn(
			`${repo.owner}/${repo.repo}: 웹훅에 installation이 없다 — App 설치 이벤트가 맞는지 확인해야 한다`,
		);
		return undefined;
	}

	const slug = `${repo.owner}/${repo.repo}`;
	if (trigger.kind !== "pull_request" && isBotActor(trigger.author)) {
		log.debug(`${slug}: 봇(${trigger.author})의 코멘트라 무시한다`);
		return undefined;
	}

	// 봇을 부르지 않은 코멘트나 관심 없는 PR 액션이면 여기서 끝낸다.
	// 슬래시 접두사는 리포지토리마다 다를 수 있으므로 `/` 로만 거르고 판정은 설정을 읽은 뒤에 한다.
	// 멘션 이름은 고정이라 여기서 끝까지 판정한다 — 남을 부른 코멘트에 API를 쓰지 않는다.
	if (trigger.kind === "issue_comment") {
		if (!trigger.body.trimStart().startsWith("/")) return undefined;
	} else if (trigger.kind === "review_comment") {
		if (
			!trigger.body.trimStart().startsWith("/") &&
			!hasMention(trigger.body, BOT_MENTION)
		)
			return undefined;
	} else if (trigger.kind === "pull_request") {
		// 닫힌 PR 에는 더 쓸 일이 없다 — 남은 상태를 지우는 작업만 넣는다
		if (CLEANUP_PR_ACTIONS.includes(trigger.action)) {
			return {
				key: `${slug}#${trigger.pr}@closed`,
				job: {
					kind: "cleanup",
					owner: repo.owner,
					repo: repo.repo,
					pr: trigger.pr,
				},
			};
		}
		if (trigger.draft || !AUTO_REVIEW_PR_ACTIONS.includes(trigger.action))
			return undefined;
	}

	return {
		key: queueKey(slug, trigger),
		job: {
			kind: "trigger",
			owner: repo.owner,
			repo: repo.repo,
			installationId,
			trigger,
		},
		// 푸시만 묶는다. 사람이 부른 명령은 기다리게 하지 않는다.
		delayMs:
			trigger.kind === "pull_request" && trigger.action === "synchronize"
				? PUSH_DEBOUNCE_MS
				: 0,
	};
}
