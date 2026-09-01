export const BOT_MARKER = "<!-- columbina-code-review-bot -->";

/**
 * 인라인 코멘트를 담아 보내는 리뷰의 본문.
 *
 * 요약은 고쳐 쓰는 PR 코멘트 쪽에 있다. 리뷰 본문에도 요약을 실으면 푸시마다
 * 같은 내용이 하나씩 더 쌓인다 — 여기서는 어디를 보면 되는지만 알린다.
 */
export const INLINE_REVIEW_BODY = `${BOT_MARKER}\n<sub>🤖 지적 사항을 인라인으로 남겼다. 전체 요약은 PR 코멘트에 있다.</sub>`;
