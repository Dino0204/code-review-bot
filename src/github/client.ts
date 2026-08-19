import { Octokit } from '@octokit/rest'
import { retry } from '@octokit/plugin-retry'
import type { RepoRef } from './event'
import { log } from '../logger'

export interface PullRequestInfo {
  number: number
  title: string
  body: string
  author: string
  baseRef: string
  headRef: string
  headSha: string
  baseSha: string
  draft: boolean
  changedFiles: number
  additions: number
  deletions: number
  htmlUrl: string
  labels: string[]
}

export interface InlineComment {
  path: string
  line: number
  startLine?: number
  body: string
}

export type Reaction = 'eyes' | '+1' | 'rocket'

/**
 * 리액션을 달 대상. 이슈 코멘트와 리뷰 코멘트는 id 네임스페이스가 따로라
 * 엔드포인트를 잘못 고르면 엉뚱한 코멘트에 붙거나 404가 난다.
 */
export type ReactionTarget = 'issue_comment' | 'review_comment'

/** 인라인 리뷰 쓰레드에 달린 코멘트 하나 */
export interface ThreadComment {
  id: number
  author: string
  body: string
  createdAt: string
  isBot: boolean
}

/** 같은 위치에 달린 인라인 코멘트 묶음 — 첫 코멘트가 쓰레드의 뿌리다 */
export interface ReviewThread {
  /** 답글을 달 때 쓰는 뿌리 코멘트 id */
  rootId: number
  path: string
  /** 변경 후 파일 기준 줄 번호. 파일 전체에 달린 코멘트에는 없다 */
  line?: number
  /** 쓰레드가 달린 뒤 그 자리가 바뀌어 현재 diff에서 사라진 상태 */
  outdated: boolean
  /** 쓰레드가 붙어 있는 diff 조각 — GitHub이 뿌리 코멘트에 실어 준다 */
  diffHunk: string
  comments: ThreadComment[]
}

export interface GitHubClient {
  getPullRequest(number: number): Promise<PullRequestInfo>
  getPullRequestDiff(number: number): Promise<string>
  readFile(path: string, ref: string): Promise<string | undefined>
  createIssueComment(number: number, body: string): Promise<number>
  createReview(
    number: number,
    commitSha: string,
    body: string,
    comments: InlineComment[],
  ): Promise<{ posted: number; degraded: boolean }>
  /** 코멘트 하나가 속한 인라인 쓰레드를 통째로 읽는다 */
  getReviewThread(number: number, commentId: number): Promise<ReviewThread | undefined>
  /** 인라인 쓰레드에 답글을 단다. commentId는 쓰레드의 뿌리 코멘트다 */
  replyToReviewComment(number: number, commentId: number, body: string): Promise<number>
  addReaction(commentId: number, content: Reaction, target: ReactionTarget): Promise<void>
  hasWriteAccess(username: string): Promise<boolean>
}

const RETRIES = 2

const RetryingOctokit = Octokit.plugin(retry)

export function createGitHubClient(token: string, repo: RepoRef): GitHubClient {
  const octokit = new RetryingOctokit({
    auth: token,
    userAgent: 'gsml-code-review-bot',
    retry: { retries: RETRIES },
    log: { debug: log.debug, info: log.debug, warn: log.warn, error: log.debug },
  })

  const postReview = (
    number: number,
    commitSha: string,
    body: string,
    comments?: ReviewComment[],
  ) =>
    octokit.rest.pulls.createReview({
      ...repo,
      pull_number: number,
      commit_id: commitSha,
      event: 'COMMENT',
      body,
      ...(comments ? { comments } : {}),
    })

  return {
    async getPullRequest(number) {
      const { data } = await octokit.rest.pulls.get({ ...repo, pull_number: number })
      return {
        number: data.number,
        title: data.title,
        body: data.body ?? '',
        author: data.user?.login ?? 'unknown',
        baseRef: data.base.ref,
        headRef: data.head.ref,
        headSha: data.head.sha,
        baseSha: data.base.sha,
        draft: Boolean(data.draft),
        changedFiles: data.changed_files,
        additions: data.additions,
        deletions: data.deletions,
        htmlUrl: data.html_url,
        labels: data.labels
          .map((label) => (typeof label === 'string' ? label : (label.name ?? '')))
          .filter(Boolean),
      }
    },

    async getPullRequestDiff(number) {
      const response = await octokit.rest.pulls.get({
        ...repo,
        pull_number: number,
        mediaType: { format: 'diff' },
      })
      return response.data as unknown as string
    },

    async readFile(path, ref) {
      try {
        const { data } = await octokit.rest.repos.getContent({
          ...repo,
          path,
          ref,
          mediaType: { format: 'raw' },
        })
        return data as unknown as string
      } catch (error) {
        if ((error as { status?: number }).status === 404) return undefined
        throw error
      }
    },

    async createIssueComment(number, body) {
      const { data } = await octokit.rest.issues.createComment({
        ...repo,
        issue_number: number,
        body,
      })
      return data.id
    },

    async createReview(number, commitSha, body, comments) {
      const payload: ReviewComment[] = comments.map((comment) => ({
        path: comment.path,
        line: comment.line,
        side: 'RIGHT' as const,
        ...(comment.startLine !== undefined && comment.startLine < comment.line
          ? { start_line: comment.startLine, start_side: 'RIGHT' as const }
          : {}),
        body: comment.body,
      }))

      try {
        await postReview(number, commitSha, body, payload)
        return { posted: payload.length, degraded: false }
      } catch (error) {
        if (payload.length === 0) throw error
        log.warn(`인라인 코멘트 등록 실패 — 요약 코멘트로 대체한다: ${(error as Error).message}`)
        await postReview(number, commitSha, body)
        return { posted: 0, degraded: true }
      }
    },

    /**
     * 쓰레드는 GitHub API에 통째로 가져오는 엔드포인트가 없다.
     * PR의 리뷰 코멘트를 모두 읽어 `in_reply_to_id` 로 묶는다 —
     * 답글은 모두 쓰레드의 뿌리를 가리키므로 뿌리 id 하나로 갈라진다.
     */
    async getReviewThread(number, commentId) {
      const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
        ...repo,
        pull_number: number,
        per_page: 100,
      })

      const target = comments.find((comment) => comment.id === commentId)
      if (!target) return undefined

      const rootId = target.in_reply_to_id ?? target.id
      const thread = comments
        .filter((comment) => (comment.in_reply_to_id ?? comment.id) === rootId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)

      // line이 비면 그 자리가 최신 diff에서 밀려났다는 뜻이다 — 위치는 original_line으로 되짚는다
      const root = thread[0] ?? target
      return {
        rootId,
        path: root.path,
        line: root.line ?? root.original_line ?? undefined,
        outdated: root.line === null || root.line === undefined,
        diffHunk: root.diff_hunk ?? '',
        comments: thread.map((comment) => ({
          id: comment.id,
          author: comment.user?.login ?? 'unknown',
          body: comment.body ?? '',
          createdAt: comment.created_at,
          isBot: comment.user?.type === 'Bot',
        })),
      }
    },

    async replyToReviewComment(number, commentId, body) {
      const { data } = await octokit.rest.pulls.createReplyForReviewComment({
        ...repo,
        pull_number: number,
        comment_id: commentId,
        body,
      })
      return data.id
    },

    async addReaction(commentId, content, target) {
      try {
        if (target === 'review_comment') {
          await octokit.rest.reactions.createForPullRequestReviewComment({
            ...repo,
            comment_id: commentId,
            content,
          })
        } else {
          await octokit.rest.reactions.createForIssueComment({
            ...repo,
            comment_id: commentId,
            content,
          })
        }
      } catch (error) {
        log.debug(`리액션 등록 실패(무시): ${(error as Error).message}`)
      }
    },

    async hasWriteAccess(username) {
      try {
        const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({
          ...repo,
          username,
        })
        return ['admin', 'write', 'maintain'].includes(data.permission)
      } catch (error) {
        log.warn(`권한 확인 실패(${username}) — 트리거를 거부한다: ${(error as Error).message}`)
        return false
      }
    },
  }
}

interface ReviewComment {
  path: string
  line: number
  side: 'RIGHT'
  start_line?: number
  start_side?: 'RIGHT'
  body: string
}
