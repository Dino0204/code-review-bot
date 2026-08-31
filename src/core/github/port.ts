export interface PullRequestInfo {
	number: number;
	title: string;
	body: string;
	author: string;
	baseRef: string;
	headRef: string;
	headSha: string;
	baseSha: string;
	draft: boolean;
	changedFiles: number;
	additions: number;
	deletions: number;
	htmlUrl: string;
	labels: string[];
}

export interface InlineComment {
	path: string;
	line: number;
	startLine?: number;
	body: string;
}

export type Reaction = "eyes" | "+1" | "rocket";

/**
 * 리액션을 달 대상. 이슈 코멘트와 리뷰 코멘트는 id 네임스페이스가 따로라
 * 엔드포인트를 잘못 고르면 엉뚱한 코멘트에 붙거나 404가 난다.
 *
 * `issue` 는 코멘트가 아니라 PR 본문이다 — 자동 리뷰처럼 사람이 부른 코멘트가
 * 없는 경우에 쓴다. GitHub은 PR을 이슈로도 다루므로 PR 번호를 그대로 넘긴다.
 */
export type ReactionTarget = "issue" | "issue_comment" | "review_comment";

/** 인라인 리뷰 쓰레드에 달린 코멘트 하나 */
export interface ThreadComment {
	id: number;
	author: string;
	body: string;
	createdAt: string;
	isBot: boolean;
}

/** 같은 위치에 달린 인라인 코멘트 묶음 — 첫 코멘트가 쓰레드의 뿌리다 */
export interface ReviewThread {
	/** 답글을 달 때 쓰는 뿌리 코멘트 id */
	rootId: number;
	path: string;
	/** 변경 후 파일 기준 줄 번호. 파일 전체에 달린 코멘트에는 없다 */
	line?: number;
	/** 쓰레드가 달린 뒤 그 자리가 바뀌어 현재 diff에서 사라진 상태 */
	outdated: boolean;
	/** 쓰레드가 붙어 있는 diff 조각 — GitHub이 뿌리 코멘트에 실어 준다 */
	diffHunk: string;
	comments: ThreadComment[];
}

export interface GitHubClient {
	getPullRequest(number: number): Promise<PullRequestInfo>;
	getPullRequestDiff(number: number): Promise<string>;
	readFile(path: string, ref: string): Promise<string | undefined>;
	createIssueComment(number: number, body: string): Promise<number>;
	createReview(
		number: number,
		commitSha: string,
		body: string,
		comments: InlineComment[],
	): Promise<{ posted: number; degraded: boolean }>;
	/** 코멘트 하나가 속한 인라인 쓰레드를 통째로 읽는다 */
	getReviewThread(
		number: number,
		commentId: number,
	): Promise<ReviewThread | undefined>;
	/** 인라인 쓰레드에 답글을 단다. commentId는 쓰레드의 뿌리 코멘트다 */
	replyToReviewComment(
		number: number,
		commentId: number,
		body: string,
	): Promise<number>;
	/** `target` 이 `issue` 면 `id` 는 코멘트가 아니라 PR 번호다 */
	addReaction(
		id: number,
		content: Reaction,
		target: ReactionTarget,
	): Promise<void>;
	hasWriteAccess(username: string): Promise<boolean>;
}

export interface ReviewComment {
	path: string;
	line: number;
	side: "RIGHT";
	start_line?: number;
	start_side?: "RIGHT";
	body: string;
}
