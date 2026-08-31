import type { PrRef } from "@/core/ports/review-state";

/**
 * PR 상태 키의 TTL.
 *
 * PR 이 닫히면 지우므로 평소에는 쓰이지 않는다. 그 이벤트를 놓쳤을 때 키가 영원히
 * 남지 않게 하는 안전망이다. 쓸 때마다 갱신하므로 살아있는 PR 의 상태는 안 지워진다.
 */
export const STATE_TTL_SECONDS = 30 * 24 * 60 * 60;

export function markerKey(ref: PrRef): string {
	return `rb:marker:${ref.owner}/${ref.repo}#${ref.pr}`;
}

/** PR 하나에 딸린 모든 상태 키 — 닫힐 때 통째로 지운다 */
export function allKeys(ref: PrRef): string[] {
	return [markerKey(ref)];
}
