import { BOT_MENTION } from "@/config/consts/bot";
import type { ChatMessage } from "@/llm/model/types";
import {
	MAX_THREAD_COMMENT_CHARS,
	MAX_THREAD_COMMENTS,
} from "../consts/thread-limits";
import { REPLY_TOOL } from "../consts/tools";
import { instructionsSection } from "../lib/instructions-section";
import { prMeta } from "../lib/pr-meta";
import { buildReplySystemPrompt } from "../lib/reply-system-prompt";
import { truncate } from "../lib/truncate";
import type { FileExcerpt, ThreadContext } from "./types";

/** 줄 번호를 붙인 파일 발췌 — 모델이 줄을 짚어 이야기할 수 있게 한다 */
function renderExcerpt(excerpt: FileExcerpt): string {
	return excerpt.lines
		.map((line, index) => `${excerpt.startLine + index} | ${line}`)
		.join("\n");
}

/**
 * 쓰레드 대화를 발언 순서대로 옮긴다.
 *
 * 봇 코멘트에 섞인 HTML 주석(마커)은 걷어낸다 — 모델에게는 아무 의미가 없고
 * 자기 출력에 그대로 흉내 낼 여지만 준다.
 */
function renderThread(context: ThreadContext): string {
	const { comments } = context.thread;
	const recent = comments.slice(-MAX_THREAD_COMMENTS);
	const dropped = comments.length - recent.length;

	const rendered = recent.map((comment) => {
		const who = comment.isBot ? `${comment.author} (너 자신)` : comment.author;
		const body = truncate(
			comment.body.replace(/<!--[\s\S]*?-->/g, "").trim(),
			MAX_THREAD_COMMENT_CHARS,
		);
		return `### ${who}\n${body || "(빈 코멘트)"}`;
	});

	if (dropped > 0) rendered.unshift(`_(앞선 코멘트 ${dropped}건은 생략됐다)_`);
	return rendered.join("\n\n");
}

export function buildReplyMessages(context: ThreadContext): ChatMessage[] {
	const { thread, excerpt, pr, config } = context;
	const location = thread.line ? `${thread.path}:${thread.line}` : thread.path;

	const userPrompt = [
		`아래 인라인 리뷰 쓰레드에서 마지막 발언에 답하라. 너를 부른 이름은 @${BOT_MENTION} 이다.`,
		"",
		"## Pull Request",
		prMeta(pr),
		"",
		"## 쓰레드 위치",
		location,
		thread.outdated
			? "이 쓰레드가 달린 뒤 해당 부분이 바뀌어, 아래 코드가 지금과 다를 수 있다. 어긋나 보이면 그 사실을 먼저 말하라."
			: "",
		"",
		"## 이 쓰레드가 달린 diff 조각",
		"```diff",
		truncate(thread.diffHunk || "(없음)", 4000),
		"```",
		excerpt
			? [
					"",
					`## ${thread.path} 현재 내용 (\`줄번호 | 코드\`)`,
					"```",
					renderExcerpt(excerpt),
					"```",
				].join("\n")
			: "",
		"",
		"## 쓰레드 대화 (오래된 순)",
		renderThread(context),
		context.instructions ? instructionsSection(context.instructions) : "",
		`\n${REPLY_TOOL} 을 한 번 호출해 답하라.`,
	].join("\n");

	return [
		{ role: "system", content: buildReplySystemPrompt(config) },
		{ role: "user", content: userPrompt },
	];
}
