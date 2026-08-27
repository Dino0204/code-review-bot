import { MAX_REPLY_CHARS } from "../consts/limits";
import { BOT_MARKER } from "../consts/marker";
import { suggestionBlock } from "./suggestion-block";

/**
 * 인라인 쓰레드에 다는 답글.
 *
 * 요약 코멘트와 달리 제목을 붙이지 않는다 — 쓰레드 안에서는 대화의 한 마디로 읽혀야 한다.
 */
export function renderThreadReply(
	reply: string,
	suggestion: string | undefined,
	meta: { model: string },
): string {
	const body = reply.trim();
	return [
		BOT_MARKER,
		body.length > MAX_REPLY_CHARS
			? `${body.slice(0, MAX_REPLY_CHARS)}\n\n_(답변이 너무 길어 잘렸다)_`
			: body,
		...suggestionBlock(suggestion),
		"",
		`<sub>모델 \`${meta.model}\`</sub>`,
	].join("\n");
}
