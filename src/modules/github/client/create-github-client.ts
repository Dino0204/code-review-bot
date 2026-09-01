import { retry } from "@octokit/plugin-retry";
import { Octokit } from "@octokit/rest";
import type { RepoRef } from "@/core/event/model/types";
import type { GitHubClient } from "@/core/github/port";
import { log } from "@/core/ports/logger";
import { addReaction } from "./add-reaction";
import { createIssueComment } from "./create-issue-comment";
import { createReview } from "./create-review";
import { getPullRequest } from "./get-pull-request";
import { getPullRequestDiff } from "./get-pull-request-diff";
import { getReviewThread } from "./get-review-thread";
import { hasWriteAccess } from "./has-write-access";
import { readFile } from "./read-file";
import { replyToReviewComment } from "./reply-to-review-comment";
import { updateIssueComment } from "./update-issue-comment";

const RETRIES = 2;

const RetryingOctokit = Octokit.plugin(retry);

export function createGitHubClient(token: string, repo: RepoRef): GitHubClient {
	const octokit = new RetryingOctokit({
		auth: token,
		userAgent: "columbina-code-review-bot",
		retry: { retries: RETRIES },
		log: {
			debug: log.debug,
			info: log.debug,
			warn: log.warn,
			error: log.debug,
		},
	});

	return {
		getPullRequest: (number) => getPullRequest(octokit, repo, number),
		getPullRequestDiff: (number) => getPullRequestDiff(octokit, repo, number),
		readFile: (path, ref) => readFile(octokit, repo, path, ref),
		createIssueComment: (number, body) =>
			createIssueComment(octokit, repo, number, body),
		updateIssueComment: (commentId, body) =>
			updateIssueComment(octokit, repo, commentId, body),
		createReview: (number, commitSha, body, comments) =>
			createReview(octokit, repo, number, commitSha, body, comments),
		getReviewThread: (number, commentId) =>
			getReviewThread(octokit, repo, number, commentId),
		replyToReviewComment: (number, commentId, body) =>
			replyToReviewComment(octokit, repo, number, commentId, body),
		addReaction: (id, content, target) =>
			addReaction(octokit, repo, id, content, target),
		hasWriteAccess: (username) => hasWriteAccess(octokit, repo, username),
	};
}
