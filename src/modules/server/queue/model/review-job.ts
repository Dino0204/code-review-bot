import { z } from "zod";
import type { AuthorAssociation, Trigger } from "@/core/event/model/types";

/**
 * 큐에 실리는 작업.
 *
 * 인메모리 큐 시절에는 클로저를 그대로 넣었지만, Redis 를 거치면 JSON 으로 직렬화된다.
 * 그래서 "무엇을 할지"를 데이터로만 적고, 실행에 필요한 의존(App 클라이언트 등)은
 * 워커가 자기 것을 쓴다.
 */
export interface ReviewJob {
	owner: string;
	repo: string;
	installationId: number;
	trigger: Trigger;
}

const association = z.enum([
	"OWNER",
	"MEMBER",
	"COLLABORATOR",
	"CONTRIBUTOR",
	"FIRST_TIME_CONTRIBUTOR",
	"FIRST_TIMER",
	"MANNEQUIN",
	"NONE",
]) satisfies z.ZodType<AuthorAssociation>;

const trigger = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("issue_comment"),
		pr: z.number(),
		commentId: z.number(),
		body: z.string(),
		author: z.string(),
		association,
	}),
	z.object({
		kind: z.literal("review_comment"),
		pr: z.number(),
		commentId: z.number(),
		body: z.string(),
		author: z.string(),
		association,
		path: z.string().optional(),
		line: z.number().optional(),
		inReplyToId: z.number().optional(),
	}),
	z.object({
		kind: z.literal("pull_request"),
		pr: z.number(),
		action: z.string(),
		author: z.string(),
		draft: z.boolean(),
	}),
]) satisfies z.ZodType<Trigger>;

const schema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1),
	installationId: z.number(),
	trigger,
}) satisfies z.ZodType<ReviewJob>;

/**
 * 큐에서 꺼낸 데이터를 검증한다.
 *
 * Redis 에 남아 있던 잡은 이전 버전이 넣은 것일 수 있다. 형식이 바뀌었는데 그대로 실행하면
 * 엉뚱한 곳에서 `undefined` 로 터져 원인을 찾기 어렵다 — 꺼내는 자리에서 멈춘다.
 */
export function parseReviewJob(data: unknown): ReviewJob {
	const parsed = schema.safeParse(data);
	if (!parsed.success) {
		const detail = parsed.error.issues
			.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
			.join(", ");
		throw new Error(`큐에서 꺼낸 작업의 형식이 맞지 않는다 — ${detail}`);
	}
	return parsed.data;
}
