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

/**
 * 재시도 정책.
 *
 * 실패는 대개 모델 서버가 잠깐 막힌 것이라 바로 다시 걸어봐야 또 막힌다.
 * 지수 백오프로 1분 → 2분 → 4분 간격을 둔다. 다시 도는 비용은 마커와 게시 기록이
 * 낮춰준다 — 이미 본 파일과 이미 단 코멘트는 건너뛴다.
 */
export const JOB_ATTEMPTS = 4;
export const JOB_BACKOFF_MS = 60_000;
