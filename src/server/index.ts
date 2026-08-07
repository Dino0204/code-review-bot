/**
 * 웹훅 서버 진입점.
 *
 * GitHub App 웹훅을 직접 받아 리뷰를 돌린다. GitHub Actions를 쓰지 않으므로
 * Actions 실행 기록도, Actions 분 소모도 없다.
 *
 *   node dist/server.mjs
 */
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { GitHubApp } from '../github/app'
import type { RawEvent } from '../github/event'
import { accept } from './handler'
import type { HandlerDeps } from './handler'
import { ReviewQueue } from './queue'
import { readBody, verifySignature } from './webhook'
import { log } from '../logger'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} 환경변수가 필요하다`)
  return value
}

/** 개인키는 값으로도, 파일 경로로도 줄 수 있다. 도커에서는 시크릿 파일 마운트가 편하다. */
function privateKey(): string {
  const path = process.env['GITHUB_APP_PRIVATE_KEY_PATH']
  if (path) return readFileSync(path, 'utf8')
  return required('GITHUB_APP_PRIVATE_KEY')
}

function allowedRepos(): string[] {
  return (process.env['REVIEWBOT_ALLOWED_REPOS'] ?? '')
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean)
}

function main(): void {
  const webhookSecret = required('GITHUB_WEBHOOK_SECRET')
  const gsmlApiKey = required('GSML_API_KEY')
  log.mask(gsmlApiKey)

  const deps: HandlerDeps = {
    app: new GitHubApp({ appId: required('GITHUB_APP_ID'), privateKey: privateKey() }),
    gsmlApiKey,
    allowedRepos: allowedRepos(),
  }

  const queue = new ReviewQueue()
  const port = Number(process.env['PORT'] ?? 3000)

  const server = createServer((request, response) => {
    handle(request, response, deps, queue, webhookSecret).catch((error: unknown) => {
      log.error(`요청 처리 실패: ${error instanceof Error ? error.message : String(error)}`)
      send(response, 500, 'internal error')
    })
  })

  server.listen(port, () => {
    const scope = deps.allowedRepos.length ? deps.allowedRepos.join(', ') : '(설치된 모든 리포지토리)'
    log.info(`웹훅 서버 시작 — 포트 ${port} / 허용 대상: ${scope}`)
  })

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log.info(`${signal} 수신 — 새 요청을 받지 않는다 (진행 중 리뷰 ${queue.size}건)`)
      server.close(() => process.exit(0))
    })
  }
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  deps: HandlerDeps,
  queue: ReviewQueue,
  webhookSecret: string,
): Promise<void> {
  const url = request.url ?? '/'

  if (request.method === 'GET' && (url === '/health' || url === '/')) {
    send(response, 200, JSON.stringify({ ok: true, queued: queue.size, active: queue.active ?? null }))
    return
  }

  if (request.method !== 'POST' || !url.startsWith('/webhook')) {
    send(response, 404, 'not found')
    return
  }

  const body = await readBody(request)
  if (!verifySignature(webhookSecret, body, request.headers['x-hub-signature-256'] as string | undefined)) {
    log.warn('서명이 맞지 않는 웹훅 요청을 거절했다')
    send(response, 401, 'bad signature')
    return
  }

  const eventName = (request.headers['x-github-event'] as string | undefined) ?? ''
  if (eventName === 'ping') {
    send(response, 200, 'pong')
    return
  }

  let payload: RawEvent
  try {
    payload = JSON.parse(body.toString('utf8')) as RawEvent
  } catch {
    send(response, 400, 'invalid json')
    return
  }

  const accepted = accept(deps, eventName, payload)
  if (!accepted) {
    send(response, 200, 'ignored')
    return
  }

  // 리뷰는 몇 분씩 걸린다. 웹훅은 바로 닫고 큐에서 처리한다.
  queue.enqueue(accepted.key, accepted.run)
  send(response, 202, 'queued')
}

function send(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(body)
}

main()
