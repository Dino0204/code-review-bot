/**
 * 자동 리뷰를 돌릴 PR 액션.
 *
 * `synchronize`(푸시)도 넣는다 — 증분 리뷰가 붙은 뒤로는 이미 본 파일을 다시 보내지 않으므로
 * 커밋마다 다시 돌려도 모델을 낭비하지 않는다. 다만 연달아 밀린 커밋을 하나로 묶기 위해
 * 디바운스를 건다(PUSH_DEBOUNCE_MS).
 */
export const AUTO_REVIEW_PR_ACTIONS = [
	"opened",
	"reopened",
	"ready_for_review",
	"synchronize",
];

/** 이 액션에서는 PR 상태(마커 등)를 지운다 — 다시 열리면 처음부터 본다 */
export const CLEANUP_PR_ACTIONS = ["closed"];

/**
 * 푸시를 묶는 시간.
 *
 * `git push` 한 번에도 이벤트가 여럿 오고, 사람은 커밋을 연달아 밀곤 한다.
 * 그때마다 리뷰를 시작하면 앞의 리뷰가 끝나기도 전에 다음 것이 밀려든다.
 * 지연 중인 잡은 새 이벤트가 갈아치우므로(deduplication.replace) 마지막 푸시 기준으로
 * 이 시간만큼 조용해진 뒤에 한 번만 돈다.
 */
export const PUSH_DEBOUNCE_MS = 60_000;
