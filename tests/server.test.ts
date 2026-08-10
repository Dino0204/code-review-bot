import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { verifySignature } from '../src/server/webhook'
import { ReviewQueue } from '../src/server/queue'
import { accept } from '../src/server/handler'
import type { HandlerDeps } from '../src/server/handler'
import { normalizePrivateKey, isTransientAuthError } from '../src/github/app'
import { describeNetworkError } from '../src/net'
import { parseTrigger } from '../src/github/event'
import type { RawEvent } from '../src/github/event'

const SECRET = 'topsecret'

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(Buffer.from(body)).digest('hex')}`
}

// --- 서명 검증 ---

test('올바른 서명은 통과한다', () => {
  const body = '{"action":"opened"}'
  assert.equal(verifySignature(SECRET, Buffer.from(body), sign(body)), true)
})

test('다른 시크릿으로 서명한 요청은 거절한다', () => {
  const body = '{"action":"opened"}'
  assert.equal(verifySignature(SECRET, Buffer.from(body), sign(body, 'wrong')), false)
})

test('본문이 한 글자라도 바뀌면 거절한다', () => {
  const signature = sign('{"action":"opened"}')
  assert.equal(verifySignature(SECRET, Buffer.from('{"action":"closed"}'), signature), false)
})

test('서명 헤더가 없으면 거절한다', () => {
  assert.equal(verifySignature(SECRET, Buffer.from('{}'), undefined), false)
})

test('길이가 다른 서명에도 예외 없이 거절한다', () => {
  // timingSafeEqual은 길이가 다르면 던진다 — 그게 새어나가면 서버가 500을 뱉는다
  assert.equal(verifySignature(SECRET, Buffer.from('{}'), 'sha256=short'), false)
})

// --- 큐 ---

test('작업을 한 번에 하나씩 순서대로 처리한다', async () => {
  const queue = new ReviewQueue()
  const order: string[] = []
  let concurrent = 0
  let maxConcurrent = 0

  const task = (name: string) => async (): Promise<void> => {
    concurrent++
    maxConcurrent = Math.max(maxConcurrent, concurrent)
    await new Promise((resolve) => setTimeout(resolve, 5))
    order.push(name)
    concurrent--
  }

  queue.enqueue('a', task('a'))
  queue.enqueue('b', task('b'))
  queue.enqueue('c', task('c'))
  await new Promise((resolve) => setTimeout(resolve, 80))

  assert.deepEqual(order, ['a', 'b', 'c'])
  assert.equal(maxConcurrent, 1)
})

test('같은 키의 대기 작업은 새 요청이 밀어낸다', async () => {
  const queue = new ReviewQueue()
  const ran: string[] = []
  const task = (name: string) => async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 5))
    ran.push(name)
  }

  queue.enqueue('busy', task('처리중'))
  queue.enqueue('pr-1', task('낡은 커밋'))
  queue.enqueue('pr-1', task('새 커밋'))
  await new Promise((resolve) => setTimeout(resolve, 80))

  assert.deepEqual(ran, ['처리중', '새 커밋'])
})

test('작업이 실패해도 큐는 멈추지 않는다', async () => {
  const queue = new ReviewQueue()
  const ran: string[] = []

  queue.enqueue('boom', () => Promise.reject(new Error('실패')))
  queue.enqueue('next', async () => {
    ran.push('next')
  })
  await new Promise((resolve) => setTimeout(resolve, 60))

  assert.deepEqual(ran, ['next'])
})

// --- 개인키 정규화 ---

test('리터럴 \\n으로 넘어온 PEM을 되살린다', () => {
  const restored = normalizePrivateKey('-----BEGIN RSA PRIVATE KEY-----\\nAAAA\\n-----END RSA PRIVATE KEY-----')
  assert.ok(restored.includes('\n'))
  assert.ok(!restored.includes('\\n'))
})

test('이미 줄바꿈이 살아 있는 PEM은 그대로 둔다', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----'
  assert.equal(normalizePrivateKey(pem), pem)
})

// octokit은 네트워크 실패를 status 500 으로, 자격증명 실패를 4xx 로 준다.
// 4xx 는 다시 불러도 같은 답이 오므로 재시도하면 안 된다.
test('자격증명 실패는 재시도하지 않고 네트워크 실패만 재시도한다', () => {
  assert.equal(isTransientAuthError(Object.assign(new Error('x'), { status: 500 })), true)
  assert.equal(isTransientAuthError(Object.assign(new Error('x'), { status: 429 })), true)
  assert.equal(isTransientAuthError(Object.assign(new Error('Integration not found'), { status: 404 })), false)
  assert.equal(isTransientAuthError(Object.assign(new Error('Bad credentials'), { status: 401 })), false)
  assert.equal(isTransientAuthError(new Error('상태 코드가 없으면 응답을 못 받은 것')), true)
})

// --- 네트워크 오류 설명 ---

test('fetch failed 뒤에 숨은 진짜 원인을 드러낸다', () => {
  const error = new TypeError('fetch failed')
  ;(error as { cause?: unknown }).cause = Object.assign(new Error('getaddrinfo ENOTFOUND api.github.com'), {
    code: 'ENOTFOUND',
  })
  const described = describeNetworkError(error)
  assert.match(described, /ENOTFOUND/)
  assert.match(described, /DNS/)
})

test('시간 초과는 그렇게 말한다', () => {
  const error = new Error('The operation was aborted')
  error.name = 'TimeoutError'
  assert.equal(describeNetworkError(error), '응답 시간 초과')
})

test('cause가 없으면 원래 메시지를 쓴다', () => {
  assert.equal(describeNetworkError(new Error('무언가 잘못됐다')), '무언가 잘못됐다')
})

// octokit은 원인을 이미 본문에 풀어 담고 cause에는 "fetch failed"만 남긴다.
// cause를 우선하면 오히려 정보가 사라지므로 본문에서 코드를 찾아야 한다.
test('cause에 코드가 없으면 본문에서 원인을 찾는다', () => {
  const error = new Error('connect ECONNREFUSED 127.0.0.1:9999')
  ;(error as { cause?: unknown }).cause = new Error('fetch failed')
  const described = describeNetworkError(error)
  assert.match(described, /ECONNREFUSED 127\.0\.0\.1:9999/)
  assert.match(described, /연결이 거부됐다/)
})

// --- 웹훅 이벤트 필터 ---

const deps: HandlerDeps = { app: {} as HandlerDeps['app'], gsmlApiKey: 'k', allowedRepos: [] }

function payload(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    repository: { owner: { login: 'it-play' }, name: 'Code-Review-Bot' },
    installation: { id: 42 },
    ...overrides,
  }
}

test('PR에 달린 슬래시 명령을 받아들인다', () => {
  const event = payload({
    action: 'created',
    issue: { number: 7, pull_request: {} },
    comment: { id: 1, body: '/review', user: { login: 'dino' }, author_association: 'OWNER' },
  })
  const accepted = accept(deps, 'issue_comment', event)
  assert.equal(accepted?.key, 'it-play/Code-Review-Bot#7')
})

test('슬래시로 시작하지 않는 코멘트는 무시한다', () => {
  const event = payload({
    action: 'created',
    issue: { number: 7, pull_request: {} },
    comment: { id: 1, body: '좋아 보이네요', user: { login: 'dino' }, author_association: 'OWNER' },
  })
  assert.equal(accept(deps, 'issue_comment', event), undefined)
})

test('봇이 남긴 코멘트에는 반응하지 않는다', () => {
  const event = payload({
    action: 'created',
    issue: { number: 7, pull_request: {} },
    comment: { id: 1, body: '/review', user: { login: 'reviewbot[bot]' }, author_association: 'NONE' },
  })
  assert.equal(accept(deps, 'issue_comment', event), undefined)
})

test('초안 PR은 자동 리뷰하지 않는다', () => {
  const event = payload({ action: 'opened', pull_request: { number: 9, draft: true, user: { login: 'dino' } } })
  assert.equal(accept(deps, 'pull_request', event), undefined)
})

test('PR이 열리면 자동 리뷰 대상이다', () => {
  const event = payload({ action: 'opened', pull_request: { number: 9, draft: false, user: { login: 'dino' } } })
  assert.equal(accept(deps, 'pull_request', event)?.key, 'it-play/Code-Review-Bot#9')
})

test('관심 없는 PR 액션은 무시한다', () => {
  const event = payload({ action: 'labeled', pull_request: { number: 9, draft: false, user: { login: 'dino' } } })
  assert.equal(accept(deps, 'pull_request', event), undefined)
})

test('installation이 없는 웹훅은 무시한다', () => {
  const event = payload({ action: 'opened', pull_request: { number: 9, draft: false, user: { login: 'dino' } } })
  delete event.installation
  assert.equal(accept(deps, 'pull_request', event), undefined)
})

test('허용 목록에 없는 리포지토리는 무시한다', () => {
  const limited: HandlerDeps = { ...deps, allowedRepos: ['someone/else'] }
  const event = payload({ action: 'opened', pull_request: { number: 9, draft: false, user: { login: 'dino' } } })
  assert.equal(accept(limited, 'pull_request', event), undefined)
})

test('일반 이슈(PR이 아닌) 코멘트는 무시한다', () => {
  const event = payload({
    action: 'created',
    issue: { number: 7 },
    comment: { id: 1, body: '/review', user: { login: 'dino' }, author_association: 'OWNER' },
  })
  assert.equal(parseTrigger('issue_comment', event), undefined)
  assert.equal(accept(deps, 'issue_comment', event), undefined)
})
