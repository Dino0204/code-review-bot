/**
 * 웹훅 본문 상한.
 *
 * GitHub 은 PR 페이로드에 커밋 목록과 본문을 통째로 싣는다. Express 기본값(100kb)으로는
 * 큰 PR 이 잘려 서명 검증부터 실패한다 — 잘린 본문의 해시는 맞을 수 없다.
 */
export const WEBHOOK_BODY_LIMIT = "25mb";
