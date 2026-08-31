/**
 * 인라인 쓰레드에서 봇을 부르는 이름. 이 이름 하나에만 반응한다.
 *
 * 리포지토리별로 바꿀 수 없게 상수로 둔다 — 부르는 이름이 리포마다 다르면
 * 사람이 어디서 뭐라고 불러야 하는지 알 수 없고, 설정을 읽기 전에는 걸러낼 수도 없다.
 */
export const BOT_MENTION = "itplay-code-review-bot";

/**
 * 이 봇의 설정 네임스페이스 키. 앞에 있는 것부터 순서대로 적용한다(뒤가 이긴다).
 *
 * 설정 파일 하나를 여러 리뷰 봇이 나눠 쓴다 — 최상위 키는 모든 봇이 읽는 공통 설정이고,
 * 봇 이름을 키로 둔 블록은 그 봇에만 적용된다. 다른 봇(`sandrone` 등)의 블록은 읽지 않는다.
 *
 * 짝이 되는 sandrone-code-review-bot 도 같은 규칙으로 `sandrone:` 블록을 읽는다.
 */
export const BOT_NAMESPACES = ["it-play", "itplay"] as const;
