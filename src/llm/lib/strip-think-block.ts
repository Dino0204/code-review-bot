import { LlmError } from "../model/errors";

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/**
 * `<think>...</think>` 블록을 걷어낸다. 이 모델은 항상 본문 앞에 추론을 붙이는데,
 * 그 안에서 답안을 미리 적어보는 일이 있어 — 걷어내지 않으면 초안에 들어 있는
 * `<tool_call>` 예시까지 실제 호출로 잡힌다.
 *
 * 여는 태그만 있고 닫히지 않았다면 응답 전체가 추론 도중에 잘린 것이다. 그 원문을 그대로
 * 넘기면 초안의 `<tool_call>` 이 실제 지적으로, 추론 문장이 리뷰 요약으로 PR에 게시된다 —
 * 잘렸다는 사실은 아무 데도 드러나지 않는다. 우회하지 않고 여기서 실패시킨다.
 */
export function stripThinkBlock(raw: string): string {
	const end = raw.indexOf(THINK_CLOSE);
	if (end !== -1) return raw.slice(end + THINK_CLOSE.length);

	if (raw.includes(THINK_OPEN)) {
		throw new LlmError(
			`모델 추론(${THINK_OPEN})이 닫히지 않았다 — 응답이 잘려 본문을 신뢰할 수 없다. ` +
				"max_tokens 를 늘리거나 리뷰 범위를 줄여야 한다",
		);
	}
	return raw;
}
