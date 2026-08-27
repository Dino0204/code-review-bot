import type {
	PullRequestInfo,
	ReviewThread,
} from "../../../github/client/model/types";
import type { ToolCall } from "../../../llm/model/types";
import { log } from "../../../logger";
import { REPLY_TOOL } from "../../prompt/consts/tools";
import { replyTools } from "../../prompt/lib/reply-tools";
import { buildReplyMessages } from "../../prompt/model/reply-messages";
import type { FileExcerpt } from "../../prompt/model/types";
import type { RawReply } from "../../schema/model/reply";
import { replySchema } from "../../schema/model/reply";
import type { ThreadDeps } from "./types";

/** 도구를 부르지 않은 응답에 붙이는 교정 지시. 형식은 도구 블록에 이미 있으므로 되풀이하지 않는다. */
function retryNudge(): string {
	return [
		"방금 응답에는 도구 호출이 없었다. 본문만 쓴 응답은 전달되지 않고 버려진다.",
		`같은 답변을 ${REPLY_TOOL} 호출 한 번으로 다시 제출하라.`,
		"<tool_call> 블록 밖에는 아무것도 쓰지 마라.",
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
 * 도구 주입은 프롬프트 기반이라 모델이 아예 안 부를 수 있다(llm.ts 참고).
 * 그 경우 한 번 더 시도하고, 그래도 못 받으면 모델이 쓴 본문을 그대로 답글로 실어
 * 사람이 부른 말에 아무 반응도 남지 않는 상황을 피한다.
 */
export async function requestReply(
	deps: ThreadDeps,
	pr: PullRequestInfo,
	thread: ReviewThread,
	excerpt: FileExcerpt | undefined,
): Promise<{ reply: RawReply; degraded: boolean }> {
	const { llm, config, instructions } = deps;
	const messages = buildReplyMessages({
		config,
		pr,
		thread,
		excerpt,
		instructions,
	});
	const tools = replyTools(config);
	const options = {
		temperature: config.temperature,
		maxTokens: config.maxOutputTokens,
	};

	let lastText = "";
	for (let attempt = 1; attempt <= 2; attempt++) {
		const attemptMessages =
			attempt === 1
				? messages
				: [...messages, { role: "user" as const, content: retryNudge() }];

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
