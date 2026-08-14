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
  addReaction(commentId: number, content: Reaction): Promise<void>
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

    async addReaction(commentId, content) {
      try {
        await octokit.rest.reactions.createForIssueComment({
          ...repo,
          comment_id: commentId,
          content,
        })
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
