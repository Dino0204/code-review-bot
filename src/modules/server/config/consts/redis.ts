/**
 * 봇이 쓰는 Redis 키의 공통 접두사.
 *
 * BullMQ 큐 키(`rb:review:*`)와 봇 상태 키(`rb:marker:*` 등)가 같은 네임스페이스에 모인다.
 * 남의 Redis 를 같이 쓰더라도 `rb:*` 만 보면 봇 것인지 알 수 있다.
 */
export const REDIS_KEY_PREFIX = "rb";
