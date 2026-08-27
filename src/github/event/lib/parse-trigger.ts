import type { AuthorAssociation, RawEvent, Trigger } from "../model/types";

const ASSOCIATIONS: AuthorAssociation[] = [
	"OWNER",
	"MEMBER",
	"COLLABORATOR",
	"CONTRIBUTOR",
	"FIRST_TIME_CONTRIBUTOR",
	"FIRST_TIMER",
	"MANNEQUIN",
	"NONE",
];

function normalizeAssociation(raw: string | undefined): AuthorAssociation {
	const value = (raw ?? "").toUpperCase() as AuthorAssociation;
	return ASSOCIATIONS.includes(value) ? value : "NONE";
}

/**
 * 웹훅 이벤트를 봇이 다룰 수 있는 트리거로 정규화한다.
 * 다룰 수 없는 이벤트면 undefined — 서버가 조용히 무시한다.
 */
export function parseTrigger(
	eventName: string,
	event: RawEvent | undefined,
): Trigger | undefined {
	if (!event) return undefined;

	if (eventName === "issue_comment") {
		if (event.action !== "created") return undefined;
		if (!event.issue?.pull_request) return undefined; // 일반 이슈 코멘트는 무시
		const pr = event.issue.number;
		const commentId = event.comment?.id;
		if (!pr || !commentId) return undefined;
		return {
			kind: "issue_comment",
			pr,
			commentId,
			body: event.comment?.body ?? "",
			author: event.comment?.user?.login ?? "unknown",
			association: normalizeAssociation(event.comment?.author_association),
		};
	}

	if (eventName === "pull_request_review_comment") {
		if (event.action !== "created") return undefined;
		const pr = event.pull_request?.number;
		const commentId = event.comment?.id;
		if (!pr || !commentId) return undefined;
		return {
			kind: "review_comment",
			pr,
			commentId,
			body: event.comment?.body ?? "",
			author: event.comment?.user?.login ?? "unknown",
			association: normalizeAssociation(event.comment?.author_association),
			path: event.comment?.path,
			line: event.comment?.line ?? event.comment?.original_line ?? undefined,
			inReplyToId: event.comment?.in_reply_to_id,
		};
	}

	if (eventName === "pull_request" || eventName === "pull_request_target") {
		const pr = event.pull_request?.number ?? event.number;
		if (!pr) return undefined;
		return {
			kind: "pull_request",
			pr,
			action: event.action ?? "unknown",
			author: event.pull_request?.user?.login ?? "unknown",
			draft: Boolean(event.pull_request?.draft),
		};
	}

	return undefined;
}
