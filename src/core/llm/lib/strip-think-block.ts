const THINK_PATTERN = /<think>[\s\S]*?<\/think>/g;
const THINK_OPEN = "<think>";

/**
 * 본문에 섞여 온 `<think>...</think>` 를 걷어낸다.
 *
 * pi-ai 는 provider 가 추론을 **별도 필드로 줄 때만** 분리한다. 본문 텍스트에 태그로
 * 섞어 보내는 모델이 있어 그 경우의 방어막으로 남긴다 — 걷어내지 않으면 추론 초안이
 * 리뷰 요약으로 PR 에 그대로 실린다.
 *
 * 여는 태그만 있고 닫히지 않았다면 그 뒤는 잘린 추론이므로 통째로 버린다. 도구 호출은
 * 이제 본문이 아니라 구조로 오기 때문에, 여기서 무엇을 버려도 지적이 사라지지 않는다.
 */
export function stripThinkBlock(raw: string): string {
	const stripped = raw.replace(THINK_PATTERN, "");
	const open = stripped.indexOf(THINK_OPEN);
	return (open === -1 ? stripped : stripped.slice(0, open)).trim();
}
