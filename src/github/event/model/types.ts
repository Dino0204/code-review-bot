export interface RepoRef {
	owner: string;
	repo: string;
}

/** GitHub이 코멘트 작성자와 리포지토리의 관계를 알려주는 값 */
export type AuthorAssociation =
	| "OWNER"
	| "MEMBER"
	| "COLLABORATOR"
	| "CONTRIBUTOR"
	| "FIRST_TIME_CONTRIBUTOR"
	| "FIRST_TIMER"
	| "MANNEQUIN"
	| "NONE";

export type Trigger =
	| {
			kind: "issue_comment";
			pr: number;
			commentId: number;
			body: string;
			author: string;
			association: AuthorAssociation;
	  }
	| {
			kind: "review_comment";
			pr: number;
			commentId: number;
			body: string;
			author: string;
			association: AuthorAssociation;
			path?: string;
			line?: number;
			inReplyToId?: number;
	  }
	| {
			kind: "pull_request";
			pr: number;
			action: string;
			author: string;
			draft: boolean;
	  };

export interface RawEvent {
	action?: string;
	number?: number;
	issue?: {
		number?: number;
		pull_request?: unknown;
	};
	comment?: {
		id?: number;
		body?: string;
		path?: string;
		line?: number | null;
		original_line?: number | null;
		in_reply_to_id?: number;
		author_association?: string;
		user?: { login?: string; type?: string };
	};
	pull_request?: {
		number?: number;
		draft?: boolean;
		user?: { login?: string };
	};
	repository?: {
		owner?: { login?: string };
		name?: string;
		full_name?: string;
		default_branch?: string;
	};
	/** GitHub App 웹훅에만 실려 온다 — 설치 토큰을 발급할 때 쓴다 */
	installation?: { id?: number };
}
