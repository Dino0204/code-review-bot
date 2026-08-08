import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto'
import { verifySignature } from '../src/server/webhook'
import { ReviewQueue } from '../src/server/queue'
import { accept } from '../src/server/handler'
import type { HandlerDeps } from '../src/server/handler'
import { normalizePrivateKey, createAppJwt } from '../src/github/app'
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

test('개인키로 App JWT를 서명하고 검증할 수 있다', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })

  const jwt = createAppJwt('12345', privateKey)
  const [header, body, signature] = jwt.split('.')
  assert.equal(jwt.split('.').length, 3)

  const claims = JSON.parse(Buffer.from(body!, 'base64url').toString()) as { iss: string; exp: number; iat: number }
  assert.equal(claims.iss, '12345')
  assert.ok(claims.exp > claims.iat, '만료가 발급보다 뒤여야 한다')
  assert.equal(JSON.parse(Buffer.from(header!, 'base64url').toString()).alg, 'RS256')

  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${header}.${body}`)
  assert.equal(verifier.verify(publicKey, Buffer.from(signature!, 'base64url')), true)
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
