import { readFileSync } from 'node:fs'

export interface RepoRef {
  owner: string
  repo: string
}

/** GitHub이 코멘트 작성자와 리포지토리의 관계를 알려주는 값 */
export type AuthorAssociation =
  | 'OWNER'
  | 'MEMBER'
  | 'COLLABORATOR'
  | 'CONTRIBUTOR'
  | 'FIRST_TIME_CONTRIBUTOR'
  | 'FIRST_TIMER'
  | 'MANNEQUIN'
  | 'NONE'

export type Trigger =
  | {
      kind: 'issue_comment'
      pr: number
      commentId: number
      body: string
      author: string
      association: AuthorAssociation
    }
  | {
      kind: 'review_comment'
      pr: number
      commentId: number
      body: string
      author: string
      association: AuthorAssociation
      path?: string
      line?: number
      inReplyToId?: number
    }
  | { kind: 'pull_request'; pr: number; action: string; author: string; draft: boolean }
  | { kind: 'manual'; pr: number; body: string; author: string }

interface RawEvent {
  action?: string
  number?: number
  issue?: {
    number?: number
    pull_request?: unknown
  }
  comment?: {
    id?: number
    body?: string
    path?: string
    line?: number | null
    original_line?: number | null
    in_reply_to_id?: number
    author_association?: string
    user?: { login?: string; type?: string }
  }
  pull_request?: {
    number?: number
    draft?: boolean
    user?: { login?: string }
  }
  inputs?: Record<string, string>
  repository?: { owner?: { login?: string }; name?: string }
}

export function readRepoRef(): RepoRef {
  const slug = process.env['GITHUB_REPOSITORY']
  if (slug) {
    const [owner, repo] = slug.split('/')
    if (owner && repo) return { owner, repo }
  }
  const event = readEventPayload()
  const owner = event?.repository?.owner?.login
  const repo = event?.repository?.name
  if (owner && repo) return { owner, repo }
  throw new Error('GITHUB_REPOSITORY를 확인할 수 없다')
}

export function readEventPayload(): RawEvent | undefined {
  const path = process.env['GITHUB_EVENT_PATH']
  if (!path) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RawEvent
  } catch {
    return undefined
  }
}

/**
 * GitHub Actions 이벤트를 봇이 다룰 수 있는 트리거로 정규화한다.
 * 대상 PR을 찾을 수 없으면 undefined — 워크플로가 조용히 종료된다.
 */
export function resolveTrigger(): Trigger | undefined {
  const eventName = process.env['GITHUB_EVENT_NAME'] ?? ''
  const event = readEventPayload()
  if (!event) return undefined

  if (eventName === 'issue_comment') {
    if (event.action !== 'created') return undefined
    if (!event.issue?.pull_request) return undefined // 일반 이슈 코멘트는 무시
    const pr = event.issue.number
    const commentId = event.comment?.id
    if (!pr || !commentId) return undefined
    return {
      kind: 'issue_comment',
      pr,
      commentId,
      body: event.comment?.body ?? '',
      author: event.comment?.user?.login ?? 'unknown',
      association: normalizeAssociation(event.comment?.author_association),
    }
  }

  if (eventName === 'pull_request_review_comment') {
    if (event.action !== 'created') return undefined
    const pr = event.pull_request?.number
    const commentId = event.comment?.id
    if (!pr || !commentId) return undefined
    return {
      kind: 'review_comment',
      pr,
      commentId,
      body: event.comment?.body ?? '',
      author: event.comment?.user?.login ?? 'unknown',
      association: normalizeAssociation(event.comment?.author_association),
      path: event.comment?.path,
      line: event.comment?.line ?? event.comment?.original_line ?? undefined,
      inReplyToId: event.comment?.in_reply_to_id,
    }
  }

  if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    const pr = event.pull_request?.number ?? event.number
    if (!pr) return undefined
    return {
      kind: 'pull_request',
      pr,
      action: event.action ?? 'unknown',
      author: event.pull_request?.user?.login ?? 'unknown',
      draft: Boolean(event.pull_request?.draft),
    }
  }

  if (eventName === 'workflow_dispatch') {
    const raw = event.inputs?.['pr'] ?? process.env['REVIEWBOT_PR']
    const pr = Number(raw)
    if (!Number.isInteger(pr) || pr <= 0) return undefined
    return {
      kind: 'manual',
      pr,
      body: event.inputs?.['command'] ?? '/review',
      author: process.env['GITHUB_ACTOR'] ?? 'unknown',
    }
  }

  return undefined
}

const ASSOCIATIONS: AuthorAssociation[] = [
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
  'CONTRIBUTOR',
  'FIRST_TIME_CONTRIBUTOR',
  'FIRST_TIMER',
  'MANNEQUIN',
  'NONE',
]

function normalizeAssociation(raw: string | undefined): AuthorAssociation {
  const value = (raw ?? '').toUpperCase() as AuthorAssociation
  return ASSOCIATIONS.includes(value) ? value : 'NONE'
}

/** 이벤트 페이로드만으로 판단 가능한 신뢰 관계 — API 호출 없이 통과시킨다 */
export function isTrustedAssociation(association: AuthorAssociation): boolean {
  return association === 'OWNER' || association === 'MEMBER' || association === 'COLLABORATOR'
}

/** 봇 자신이 남긴 코멘트에 반응해 무한 루프에 빠지지 않도록 */
export function isBotActor(login: string): boolean {
  return login.endsWith('[bot]') || login === 'github-actions'
}
