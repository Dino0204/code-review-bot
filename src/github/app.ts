import { createSign } from 'node:crypto'
import { describeNetworkError } from '../net'
import { log } from '../logger'

/**
 * GitHub App 인증.
 *
 * 개인키로 서명한 JWT로 App 자신을 증명하고, 그걸로 설치별 액세스 토큰을 받아온다.
 * 설치 토큰은 1시간 유효하며 Octokit에 그대로 넘길 수 있다.
 *
 * @octokit/auth-app을 쓰지 않고 직접 구현한다 — RS256 서명과 토큰 교환이 전부라
 * 의존성을 하나 더 늘릴 이유가 없다.
 */
export interface AppCredentials {
  appId: string
  privateKey: string
}

interface CachedToken {
  token: string
  /** 만료 시각(ms). 실제 만료보다 일찍 버려서 사용 중 만료를 피한다 */
  expiresAt: number
}

const API = 'https://api.github.com'
/** 실제 만료 5분 전에 새로 받는다 — 리뷰가 몇 분씩 걸리므로 여유가 필요하다 */
const RENEW_MARGIN_MS = 5 * 60_000

export class GitHubApp {
  private readonly appId: string
  private readonly privateKey: string
  private readonly cache = new Map<number, CachedToken>()

  constructor(credentials: AppCredentials) {
    if (!credentials.appId) throw new Error('GITHUB_APP_ID가 비어 있다')
    if (!credentials.privateKey) throw new Error('GITHUB_APP_PRIVATE_KEY가 비어 있다')
    this.appId = credentials.appId
    this.privateKey = normalizePrivateKey(credentials.privateKey)
  }

  /** 설치 ID에 대한 액세스 토큰. 유효한 캐시가 있으면 재사용한다. */
  async installationToken(installationId: number): Promise<string> {
    const cached = this.cache.get(installationId)
    if (cached && cached.expiresAt - RENEW_MARGIN_MS > Date.now()) return cached.token

    const url = `${API}/app/installations/${installationId}/access_tokens`
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.jwt()}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'gsml-code-review-bot',
        },
        signal: AbortSignal.timeout(30_000),
      })
    } catch (error) {
      // fetch는 네트워크 실패를 전부 "fetch failed"로 뭉개고 진짜 원인을 cause에 숨긴다.
      // 여기가 봇이 GitHub에 처음 말을 거는 지점이라, 망 문제면 이 메시지만 보고 판단해야 한다.
      throw new Error(`GitHub API에 연결하지 못했다 (${url}): ${describeNetworkError(error)}`)
    }

    const text = await response.text()
    if (!response.ok) {
      throw new Error(`설치 토큰 발급 실패 (HTTP ${response.status}): ${text.slice(0, 300)}`)
    }

    const data = JSON.parse(text) as { token?: string; expires_at?: string }
    if (!data.token) throw new Error('설치 토큰 응답에 token이 없다')

    const expiresAt = data.expires_at ? Date.parse(data.expires_at) : Date.now() + 3600_000
    this.cache.set(installationId, { token: data.token, expiresAt })
    log.mask(data.token)
    return data.token
  }

  private jwt(): string {
    return createAppJwt(this.appId, this.privateKey)
  }
}

/**
 * App 자신을 증명하는 JWT.
 * iat를 1분 앞당겨 서버 시계가 조금 빨라도 거절되지 않게 한다(GitHub 권장).
 */
export function createAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iat: now - 60, exp: now + 540, iss: appId }

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  const signature = signer.sign(normalizePrivateKey(privateKey)).toString('base64url')
  return `${signingInput}.${signature}`
}

/**
 * 환경변수로 넘어온 PEM을 되살린다.
 * docker-compose나 .env를 거치면 줄바꿈이 리터럴 `\n` 두 글자로 오는 경우가 흔하다.
 */
export function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.includes('\\n') ? trimmed.replace(/\\n/g, '\n') : trimmed
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url')
}
