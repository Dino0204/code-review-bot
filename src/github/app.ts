import { createAppAuth } from '@octokit/auth-app'
import { describeNetworkError } from '../net'

/**
 * GitHub App 인증.
 *
 * 개인키로 서명한 JWT로 App 자신을 증명하고, 그걸로 설치별 액세스 토큰을 받아온다.
 * 설치 토큰은 1시간 유효하며 Octokit에 그대로 넘길 수 있다.
 *
 * RS256 서명·토큰 교환·만료 캐싱은 GitHub이 정한 규격이라 @octokit/auth-app에 맡긴다.
 * 여기서 직접 하는 일은 두 가지뿐이다 — 환경변수로 깨진 PEM 복원, 네트워크 오류 진단.
 */
export interface AppCredentials {
  appId: string
  privateKey: string
}

export class GitHubApp {
  private readonly auth: ReturnType<typeof createAppAuth>

  constructor(credentials: AppCredentials) {
    if (!credentials.appId) throw new Error('GITHUB_APP_ID가 비어 있다')
    if (!credentials.privateKey) throw new Error('GITHUB_APP_PRIVATE_KEY가 비어 있다')
    this.auth = createAppAuth({
      appId: credentials.appId,
      privateKey: normalizePrivateKey(credentials.privateKey),
    })
  }

  /** 설치 ID에 대한 액세스 토큰. 만료 전까지는 라이브러리가 캐시를 재사용한다. */
  async installationToken(installationId: number): Promise<string> {
    try {
      const { token } = await this.auth({ type: 'installation', installationId })
      return token
    } catch (error) {
      // 여기가 봇이 GitHub에 처음 말을 거는 지점이다. 망 문제라면 이 메시지만 보고
      // 판단해야 하는데, fetch는 실패 원인을 전부 "fetch failed"로 뭉개 cause에 숨긴다.
      throw new Error(`설치 토큰 발급 실패 (installation ${installationId}): ${describeNetworkError(error)}`)
    }
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
