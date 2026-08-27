/** 자동 리뷰를 돌릴 PR 액션. 푸시(synchronize)만 제외한다 — 커밋을 밀 때마다 다시 돌리지 않는다. */
export const AUTO_REVIEW_PR_ACTIONS = [
	"opened",
	"reopened",
	"ready_for_review",
];
