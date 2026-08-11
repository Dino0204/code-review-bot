import { Octokit } from "@octokit/core";
import { retry } from "@octokit/plugin-retry";
import { createAppAuth } from "@octokit/auth-app";
import { describeNetworkError } from "../net";
import { log } from "../logger";

export interface AppCredentials {
  appId: string;
  privateKey: string;
}

/**
 * App 인증에서 바깥이 필요로 하는 것은 이것 하나뿐이다.
 * 인터페이스로 두면 호출부가 구현이 아니라 이 계약에만 묶인다.
 */
export interface GitHubApp {
  installationToken(installationId: number): Promise<string>;
}

/**
 * 이 봇이 도는 망에서는 **새 연결의 TLS 핸드셰이크가 가끔 통째로 멈춘다.**
 * TCP는 10ms에 붙는데 그 위 핸드셰이크가 응답 없이 10초를 넘겨 죽는다 (측정: 20회 중 1회).
 * 한 번 연결이 서면 undici가 그 연결을 재사용해 이후 호출은 20ms 안에 끝난다.
 *
 * 설치 토큰 발급이 매 리뷰의 첫 API 호출이라 이 지점이 항상 "첫 연결"에 걸린다.
 * 여기서 실패하면 리뷰를 시작조차 못 하므로 재시도를 붙인다.
 *
 * 재시도 판정은 plugin-retry에 맡긴다. 연결 실패는 octokit이 status 500으로 감싸므로
 * (@octokit/request의 fetch-wrapper) 재시도 대상이 되고, 401·403·404처럼 다시 불러도
 * 결과가 같은 응답은 plugin-retry의 doNotRetry 기본값이 걸러낸다.
 */
const RETRIES = 2;

const RetryingOctokit = Octokit.plugin(retry);

export function createGitHubApp(credentials: AppCredentials): GitHubApp {
  if (!credentials.appId) throw new Error("GITHUB_APP_ID가 비어 있다");
  if (!credentials.privateKey)
    throw new Error("GITHUB_APP_PRIVATE_KEY가 비어 있다");

  const octokit = new RetryingOctokit({ retry: { retries: RETRIES } });

  // 재시도는 plugin-retry가 Bottleneck 안에서 돌리므로 이 훅은 매 시도가 아니라
  // 최종 실패 때 한 번만 온다. 대신 몇 번 시도했는지는 여기서만 알 수 있다.
  octokit.hook.error("request", (error, options) => {
    const attempts = options.request.retryCount;
    if (typeof attempts === "number" && attempts > 1) {
      log.warn(`설치 토큰 발급 ${attempts}회 시도 후 실패`);
    }
    throw error;
  });

  const auth = createAppAuth({
    appId: credentials.appId,
    privateKey: normalizePrivateKey(credentials.privateKey),
    request: octokit.request,
  });

  return {
    /** 설치 ID에 대한 액세스 토큰. 만료 전까지는 auth-app이 캐시를 재사용한다. */
    async installationToken(installationId: number): Promise<string> {
      try {
        const { token } = await auth({ type: "installation", installationId });
        return token;
      } catch (error) {
        // 여기가 봇이 GitHub에 처음 말을 거는 지점이다. 망 문제라면 이 메시지만 보고
        // 판단해야 하는데, fetch는 실패 원인을 전부 "fetch failed"로 뭉개 cause에 숨긴다.
        throw new Error(
          `설치 토큰 발급 실패 (installation ${installationId}): ${describeNetworkError(error)}`,
        );
      }
    },
  };
}

/**
 * 환경변수로 넘어온 PEM을 되살린다.
 * docker-compose나 .env를 거치면 줄바꿈이 리터럴 `\n` 두 글자로 오는 경우가 흔하다.
 */
export function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.includes("\\n") ? trimmed.replace(/\\n/g, "\n") : trimmed;
}
