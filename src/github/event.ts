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

export interface RawEvent {
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
  repository?: { owner?: { login?: string }; name?: string; full_name?: string; default_branch?: string }
  /** GitHub App 웹훅에만 실려 온다 — 설치 토큰을 발급할 때 쓴다 */
  installation?: { id?: number }
}

/** 이벤트 페이로드에서 리포지토리를 읽는다 — 웹훅에는 항상 실려 온다 */
export function repoRefFrom(event: RawEvent | undefined): RepoRef | undefined {
  const owner = event?.repository?.owner?.login
  const repo = event?.repository?.name
  return owner && repo ? { owner, repo } : undefined
}

/**
 * 웹훅 이벤트를 봇이 다룰 수 있는 트리거로 정규화한다.
 * 다룰 수 없는 이벤트면 undefined — 서버가 조용히 무시한다.
 */
export function parseTrigger(eventName: string, event: RawEvent | undefined): Trigger | undefined {
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
