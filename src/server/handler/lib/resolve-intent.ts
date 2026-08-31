import { BOT_MENTION } from "@/config/consts/bot";
import type { BotConfig } from "@/config/model/bot-config";
import type { Trigger } from "@/github/event/model/types";
import { hasMention } from "@/review/commands/lib/has-mention";
import { hasReviewTrigger } from "@/review/commands/lib/has-review-trigger";
import type { Intent } from "../model/types";

/**
 * 이 트리거로 무엇을 할지 정한다. 설정을 읽은 뒤에 판단한다.
 *
 * 인라인 쓰레드에서는 `/review` 명령과 멘션이 둘 다 올 수 있다.
 * 명령을 먼저 본다 — 명시적으로 리뷰를 시킨 사람에게 잡담으로 답하면 안 된다.
 */
export function resolveIntent(
	trigger: Trigger,
	config: BotConfig,
): Intent | undefined {
	switch (trigger.kind) {
		case "pull_request":
			return config.autoReview ? { kind: "review" } : undefined;

		case "issue_comment":
			return hasReviewTrigger(trigger.body, config.triggerPrefix)
				? { kind: "review" }
				: undefined;

		case "review_comment": {
			if (hasReviewTrigger(trigger.body, config.triggerPrefix))
				return { kind: "review" };
			if (!config.threadReply) return undefined;
			// accept 는 슬래시로 시작하는 코멘트도 통과시킨다 — `/review` 가 아닌 명령이 여기까지 온다
			if (!hasMention(trigger.body, BOT_MENTION)) return undefined;
			return { kind: "reply", commentId: trigger.commentId };
		}
	}
}
