/** BullMQ 큐 이름. Redis 키는 `rb:review:*` 로 잡힌다 */
export const REVIEW_QUEUE = "review";

/**
 * 동시 실행이 1인 이유는 모델 서버가 슬롯을 하나만 주기 때문이다.
 * 병렬로 보내봐야 서로를 밀어낼 뿐이다.
 */
export const REVIEW_CONCURRENCY = 1;

/**
 * 잡 보존 정책.
 *
 * 성공한 잡은 짧게, 실패한 잡은 길게 남긴다 — 실패는 사람이 나중에 들여다볼 일이 있다.
 * 무한정 쌓아두면 Redis 메모리를 계속 먹는다.
 */
export const KEEP_COMPLETED = { age: 3600, count: 200 };
export const KEEP_FAILED = { age: 86400 * 3, count: 500 };
