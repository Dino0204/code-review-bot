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

export type Reaction = 'eyes' | '+1' | 'confused' | 'rocket'

/**
 * 리뷰가 GitHub에 대해 할 수 있는 일 전부.
 * 인터페이스로 두면 호출부가 구현이 아니라 이 계약에만 묶인다.
 */
export interface GitHubClient {
  getPullRequest(number: number): Promise<PullRequestInfo>
  /** PR 전체 diff 원문 */
  getPullRequestDiff(number: number): Promise<string>
  /** 리포지토리의 파일 하나. 없으면 undefined. 체크아웃 없이 설정 파일만 가져오는 데 쓴다. */
  readFile(path: string, ref: string): Promise<string | undefined>
  createIssueComment(number: number, body: string): Promise<number>
  createReview(
    number: number,
    commitSha: string,
    body: string,
    comments: InlineComment[],
  ): Promise<{ posted: number; degraded: boolean }>
  addReaction(commentId: number, content: Reaction): Promise<void>
  /** 아무나 봇을 트리거해 API 쿼터를 태우지 못하도록 쓰기 권한을 확인한다 */
  hasWriteAccess(username: string): Promise<boolean>
}

const RETRIES = 2

const RetryingOctokit = Octokit.plugin(retry)

export function createGitHubClient(token: string, repo: RepoRef): GitHubClient {
  const octokit = new RetryingOctokit({
    auth: token,
    userAgent: 'gsml-code-review-bot',
    retry: { retries: RETRIES },
    // octokit은 실패한 요청마다 영문 한 줄을 console.error로 찍는다(plugin-request-log).
    // 실패는 우리가 한국어로 정리해 알리고, 설정 파일 404처럼 정상인 실패도 있어서 디버그로 내린다.
    log: { debug: log.debug, info: log.debug, warn: log.warn, error: log.debug },
  })

  /** 인라인 코멘트 유무만 다른 두 번의 등록을 한 곳으로 모은다 */
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
      // format:diff를 쓰면 body가 문자열로 온다 (타입 정의는 객체로 되어 있음)
      return response.data as unknown as string
    },

    async readFile(path, ref) {
      try {
        const { data } = await octokit.rest.repos.getContent({
          ...repo,
          path,
          ref,
          // format:raw면 본문이 문자열로 온다 — base64로 받아 직접 푸는 단계가 없어진다
          mediaType: { format: 'raw' },
        })
        return data as unknown as string
      } catch (error) {
        // 설정 파일이 없는 건 정상이다. 그 외(권한 부족, 망 문제)까지 삼키면
        // 기본 설정으로 리뷰가 돌아버려 문제가 드러나지 않는다.
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

    /**
     * 요약 + 인라인 코멘트를 한 번의 리뷰로 등록한다.
     * 인라인 코멘트 하나라도 위치 검증에 실패하면 GitHub이 리뷰 전체를 422로 거절하므로,
     * 실패 시 인라인 없이 요약만 다시 등록한다.
     */
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

/** createReview가 GitHub에 넘기는 인라인 코멘트 모양 */
interface ReviewComment {
  path: string
  line: number
  side: 'RIGHT'
  start_line?: number
  start_side?: 'RIGHT'
  body: string
}
