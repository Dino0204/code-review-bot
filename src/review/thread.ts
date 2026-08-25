import type { BotConfig } from "../config";
import type {
	GitHubClient,
	PullRequestInfo,
	ReviewThread,
} from "../github/client";
import type { LlmClient, ToolCall } from "../llm";
import { log } from "../logger";
import type { FileExcerpt, RepoInstructions } from "./prompt";
import { buildReplyMessages, REPLY_TOOL, replyTools } from "./prompt";
import { renderThreadReply } from "./render";
import type { RawReply } from "./schema";
import { replySchema } from "./schema";

export interface ThreadDeps {
	github: GitHubClient;
	llm: LlmClient;
	config: BotConfig;
	/** 리포지토리 지침 문서. 없는 리포지토리도 있으므로 선택 사항이다 */
	instructions?: RepoInstructions;
}

export interface ThreadOutcome {
	replied: boolean;
	/** 도구 호출을 받지 못해 모델 본문을 그대로 실은 경우 */
	degraded: boolean;
}

/** 쓰레드가 가리키는 줄의 앞뒤로 실어 보낼 줄 수 */
const EXCERPT_RADIUS = 40;

/**
 * 인라인 리뷰 쓰레드에서 봇을 부른 코멘트에 답한다.
 *
 * 리뷰와 달리 대상이 diff 전체가 아니라 쓰레드 한 곳이다 — 그 자리의 diff 조각,
 * 현재 파일 내용, 오간 대화만 실어 보낸다. 답은 같은 쓰레드에 답글로 달린다.
 */
export async function answerThread(
	deps: ThreadDeps,
	pr: PullRequestInfo,
	commentId: number,
): Promise<ThreadOutcome> {
	const { github, llm, config } = deps;

	const thread = await github.getReviewThread(pr.number, commentId);
	if (!thread) {
		// 코멘트가 지워졌거나 이 PR의 것이 아니다. 답글을 달 자리가 없으니 조용히 끝낸다.
		log.warn(`#${pr.number}: 코멘트 ${commentId}가 속한 쓰레드를 찾지 못했다`);
		return { replied: false, degraded: false };
	}

	const excerpt = await loadExcerpt(github, thread, pr.headSha);
	log.info(
		`#${pr.number} 쓰레드 응답 — ${thread.path}${thread.line ? `:${thread.line}` : ""}, 코멘트 ${thread.comments.length}건` +
			`${excerpt ? "" : " (파일 발췌 없음)"}`,
	);

	const { reply, degraded } = await requestReply(deps, pr, thread, excerpt);
	await github.replyToReviewComment(
		pr.number,
		thread.rootId,
		renderThreadReply(reply.reply, reply.suggestion ?? undefined, {
			model: llm.model,
		}),
	);

	log.info(
		`#${pr.number} 쓰레드 응답 완료 (토큰 ${llm.totalUsage.total_tokens.toLocaleString()}, 모델 ${config.model})`,
	);
	return { replied: true, degraded };
}

/**
 * 모델에게 도구를 제시해 답변을 받는다.
 *
 * 도구 주입은 프롬프트 기반이라 모델이 아예 안 부를 수 있다(llm.ts 참고).
 * 그 경우 한 번 더 시도하고, 그래도 못 받으면 모델이 쓴 본문을 그대로 답글로 실어
 * 사람이 부른 말에 아무 반응도 남지 않는 상황을 피한다.
 */
async function requestReply(
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
 * 쓰레드가 가리키는 줄 주변의 현재 파일 내용을 읽는다.
 *
 * diff 조각만으로는 몇 줄밖에 보이지 않아서, 함수 하나가 어떻게 생겼는지도 알 수 없다.
 * 파일을 읽지 못하면(삭제됐거나 너무 큰 경우) 그냥 없이 간다 — 답변을 막을 이유는 아니다.
 */
async function loadExcerpt(
	github: GitHubClient,
	thread: ReviewThread,
	ref: string,
): Promise<FileExcerpt | undefined> {
	if (!thread.line) return undefined;

	let raw: string | undefined;
	try {
		raw = await github.readFile(thread.path, ref);
	} catch (error) {
		log.warn(
			`파일 발췌 실패(무시): ${thread.path} — ${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
	if (raw === undefined) return undefined;

	const lines = raw.split("\n");
	const startLine = Math.max(1, thread.line - EXCERPT_RADIUS);
	const endLine = Math.min(lines.length, thread.line + EXCERPT_RADIUS);
	if (startLine > lines.length) return undefined;

	return { startLine, lines: lines.slice(startLine - 1, endLine) };
}
