import type { ChatMessage, ToolCall } from "@/core/llm/model/types";
import { log } from "@/core/ports/logger";
import { REPLY_TOOL } from "@/core/review/prompt/consts/tools";
import { replyTools } from "@/core/review/prompt/lib/reply-tools";
import type { RawReply } from "@/core/review/schema/model/reply";
import { replySchema } from "@/core/review/schema/model/reply";
import type { ReplyDeps } from "./types";

/** 도구를 부르지 않은 응답에 붙이는 교정 지시 */
function retryNudge(): string {
	return [
		"방금 응답에는 도구 호출이 없었다. 본문만 쓴 응답은 전달되지 않고 버려진다.",
		`같은 답변을 ${REPLY_TOOL} 호출 한 번으로 다시 제출하라.`,
	].join("\n");
}

/**
 * 도구 호출에서 답변 하나를 고른다.
 *
 * 모델이 도구를 여러 번 부르면 검증을 통과한 첫 답변만 쓴다 —
 * 쓰레드에 답글을 여러 개 다는 것보다 하나만 다는 편이 대화로 읽힌다.
 */
function collectReply(toolCalls: ToolCall[]): RawReply | undefined {
	for (const call of toolCalls) {
		if (call.name !== REPLY_TOOL) {
			log.warn(`모델이 알 수 없는 도구를 호출했다: ${call.name}`);
			continue;
		}

		const parsed = replySchema.safeParse(call.arguments);
		if (parsed.success) return parsed.data;

		const issues = parsed.error.issues
			.slice(0, 3)
			.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
			.join("; ");
		log.warn(`답변이 스키마와 맞지 않아 버렸다 — ${issues}`);
	}
	return undefined;
}

/**
 * 모델에게 도구를 제시해 답변을 받는다.
 *
 * 리뷰와 달리 지적을 스키마로 걸러 실패시키지 않는다 — 답글은 사람이 읽고 마는 글이라
 * 틀린 줄 번호로 GitHub 422 를 부를 자리가 없다. 도구를 아예 안 부르면 한 번 더 시도하고,
 * 그래도 못 받으면 모델이 쓴 본문을 그대로 답글로 실어 사람이 부른 말에 아무 반응도
 * 남지 않는 상황을 피한다.
 */
export async function requestReply(
	deps: ReplyDeps,
	messages: ChatMessage[],
): Promise<{ reply: RawReply; degraded: boolean }> {
	const { llm, config } = deps;
	const tools = replyTools(config);
	const options = {
		temperature: config.temperature,
		maxTokens: config.maxOutputTokens,
	};

	let lastText = "";
	for (let attempt = 1; attempt <= 2; attempt++) {
		const attemptMessages: ChatMessage[] =
			attempt === 1
				? messages
				: [...messages, { role: "user", content: retryNudge() }];

		const { toolCalls, text } = await llm.chatWithTools(
			attemptMessages,
			tools,
			options,
		);
		const reply = collectReply(toolCalls);
		if (reply)
			return {
				reply: { ...reply, reply: reply.reply.trim() },
				degraded: false,
			};

		lastText = text;
		log.warn(`모델이 도구를 호출하지 않았다 (${attempt}/2)`);
	}

	if (!lastText.trim())
		throw new Error("모델이 답변도 도구 호출도 내놓지 않았다");
	return {
		reply: { reply: lastText.trim(), suggestion: undefined },
		degraded: true,
	};
}
