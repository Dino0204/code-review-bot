import { createAppAuth } from '@octokit/auth-app'
import { describeNetworkError } from '../net'
import { log } from '../logger'

export interface AppCredentials {
  appId: string
  privateKey: string
}

/**
 * App 인증에서 바깥이 필요로 하는 것은 이것 하나뿐이다.
 * 인터페이스로 두면 호출부가 구현이 아니라 이 계약에만 묶인다.
 */
export interface GitHubApp {
  installationToken(installationId: number): Promise<string>
}

/**
 * 이 봇이 도는 망에서는 **새 연결의 TLS 핸드셰이크가 가끔 통째로 멈춘다.**
 * TCP는 10ms에 붙는데 그 위 핸드셰이크가 응답 없이 10초를 넘겨 죽는다 (측정: 20회 중 1회).
 * 한 번 연결이 서면 undici가 그 연결을 재사용해 이후 호출은 20ms 안에 끝난다.
 *
 * 설치 토큰 발급이 매 리뷰의 첫 API 호출이라 이 지점이 항상 "첫 연결"에 걸린다.
 * 여기서 실패하면 리뷰를 시작조차 못 하므로, 이 호출에만 재시도를 둔다.
 */
const MAX_ATTEMPTS = 3

/**
 * 다시 불러볼 가치가 있는 오류인가.
 * 응답을 받았다면(4xx) 자격증명 문제라 다시 불러도 같다 — 429와 5xx, 그리고 응답 자체가 없는 경우만 재시도한다.
 */
export function isTransientAuthError(error: unknown): boolean {
  const status = (error as { status?: number }).status
  if (typeof status !== 'number') return true
  return status === 429 || status >= 500
}

/**
 * 자격증명을 검증하고 토큰 발급기를 만든다.
 *
 * 서버 부팅 때 한 번만 부른다 — 여기서 던지면 첫 웹훅이 아니라 기동 시점에 죽는다.
 */
export function createGitHubApp(credentials: AppCredentials): GitHubApp {
  if (!credentials.appId) throw new Error('GITHUB_APP_ID가 비어 있다')
  if (!credentials.privateKey) throw new Error('GITHUB_APP_PRIVATE_KEY가 비어 있다')

  // auth 인스턴스가 곧 토큰 캐시다. 호출마다 새로 만들면 만료 전 토큰을 버리고
  // 매번 JWT를 다시 서명하게 되므로 클로저에 한 번만 잡아둔다.
  const auth = createAppAuth({
    appId: credentials.appId,
    privateKey: normalizePrivateKey(credentials.privateKey),
  })

  return {
    /** 설치 ID에 대한 액세스 토큰. 만료 전까지는 라이브러리가 캐시를 재사용한다. */
    async installationToken(installationId: number): Promise<string> {
      let lastError: unknown
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const { token } = await auth({ type: 'installation', installationId })
          if (attempt > 1) log.info(`설치 토큰 발급 성공 (${attempt}번째 시도)`)
          return token
        } catch (error) {
          lastError = error
          if (!isTransientAuthError(error) || attempt === MAX_ATTEMPTS) break
          log.warn(
            `설치 토큰 발급 재시도 ${attempt}/${MAX_ATTEMPTS - 1} — ${describeNetworkError(error)}`,
          )
          await sleep(attempt * 1000)
        }
      }

      // 여기가 봇이 GitHub에 처음 말을 거는 지점이다. 망 문제라면 이 메시지만 보고
      // 판단해야 하는데, fetch는 실패 원인을 전부 "fetch failed"로 뭉개 cause에 숨긴다.
      throw new Error(
        `설치 토큰 발급 실패 (installation ${installationId}): ${describeNetworkError(lastError)}`,
      )
    },
  }
}

/**
 * 환경변수로 넘어온 PEM을 되살린다.
 * docker-compose나 .env를 거치면 줄바꿈이 리터럴 `\n` 두 글자로 오는 경우가 흔하다.
 */
export function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.includes('\\n') ? trimmed.replace(/\\n/g, '\n') : trimmed
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
