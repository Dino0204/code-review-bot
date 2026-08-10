import { Octokit } from '@octokit/rest'
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

export class GitHubClient {
  private readonly octokit: Octokit

  constructor(
    token: string,
    readonly repo: RepoRef,
  ) {
    this.octokit = new Octokit({ auth: token, userAgent: 'gsml-code-review-bot' })
  }

  async getPullRequest(number: number): Promise<PullRequestInfo> {
    const { data } = await this.octokit.rest.pulls.get({ ...this.repo, pull_number: number })
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
      labels: data.labels.map((label) => (typeof label === 'string' ? label : (label.name ?? ''))).filter(Boolean),
    }
  }

  /** PR 전체 diff 원문 */
  async getPullRequestDiff(number: number): Promise<string> {
    const response = await this.octokit.rest.pulls.get({
      ...this.repo,
      pull_number: number,
      mediaType: { format: 'diff' },
    })
    // format:diff를 쓰면 body가 문자열로 온다 (타입 정의는 객체로 되어 있음)
    return response.data as unknown as string
  }

  async createIssueComment(number: number, body: string): Promise<number> {
    const { data } = await this.octokit.rest.issues.createComment({
      ...this.repo,
      issue_number: number,
      body,
    })
    return data.id
  }

  /**
   * 요약 + 인라인 코멘트를 한 번의 리뷰로 등록한다.
   * 인라인 코멘트 하나라도 위치 검증에 실패하면 GitHub이 리뷰 전체를 422로 거절하므로,
   * 실패 시 인라인 없이 요약만 다시 등록한다.
   */
  async createReview(
    number: number,
    commitSha: string,
    body: string,
    comments: InlineComment[],
  ): Promise<{ posted: number; degraded: boolean }> {
    const payload = comments.map((comment) => ({
      path: comment.path,
      line: comment.line,
      side: 'RIGHT' as const,
      ...(comment.startLine !== undefined && comment.startLine < comment.line
        ? { start_line: comment.startLine, start_side: 'RIGHT' as const }
        : {}),
      body: comment.body,
    }))

    try {
      await this.octokit.rest.pulls.createReview({
        ...this.repo,
        pull_number: number,
        commit_id: commitSha,
        event: 'COMMENT',
        body,
        comments: payload,
      })
      return { posted: payload.length, degraded: false }
    } catch (error) {
      if (payload.length === 0) throw error
      log.warn(`인라인 코멘트 등록 실패 — 요약 코멘트로 대체한다: ${(error as Error).message}`)
      await this.octokit.rest.pulls.createReview({
        ...this.repo,
        pull_number: number,
        commit_id: commitSha,
        event: 'COMMENT',
        body,
      })
      return { posted: 0, degraded: true }
    }
  }

  async addReaction(commentId: number, content: 'eyes' | '+1' | 'confused' | 'rocket'): Promise<void> {
    try {
      await this.octokit.rest.reactions.createForIssueComment({
        ...this.repo,
        comment_id: commentId,
        content,
      })
    } catch (error) {
      log.debug(`리액션 등록 실패(무시): ${(error as Error).message}`)
    }
  }

  /** 아무나 봇을 트리거해 API 쿼터를 태우지 못하도록 쓰기 권한을 확인한다 */
  async hasWriteAccess(username: string): Promise<boolean> {
    try {
      const { data } = await this.octokit.rest.repos.getCollaboratorPermissionLevel({
        ...this.repo,
        username,
      })
      return ['admin', 'write', 'maintain'].includes(data.permission)
    } catch (error) {
      log.warn(`권한 확인 실패(${username}) — 트리거를 거부한다: ${(error as Error).message}`)
      return false
    }
  }
}
