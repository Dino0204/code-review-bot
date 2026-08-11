import { Octokit } from "@octokit/core";
import { retry } from "@octokit/plugin-retry";
import { createAppAuth } from "@octokit/auth-app";
import { describeNetworkError } from "../net";

export interface AppCredentials {
  appId: string;
  privateKey: string;
}

export interface GitHubApp {
  installationToken(installationId: number): Promise<string>;
}

const RETRIES = 2;

const RetryingOctokit = Octokit.plugin(retry);

export function createGitHubApp(credentials: AppCredentials): GitHubApp {
  if (!credentials.appId) throw new Error("GITHUB_APP_ID가 비어 있다");
  if (!credentials.privateKey)
    throw new Error("GITHUB_APP_PRIVATE_KEY가 비어 있다");

  const octokit = new RetryingOctokit({ retry: { retries: RETRIES } });

  const auth = createAppAuth({
    appId: credentials.appId,
    privateKey: normalizePrivateKey(credentials.privateKey),
    request: octokit.request,
  });

  return {
    async installationToken(installationId: number): Promise<string> {
      try {
        const { token } = await auth({ type: "installation", installationId });
        return token;
      } catch (error) {
        throw new Error(
          `설치 토큰 발급 실패 (installation ${installationId}${retriesOf(error)}): ${describeNetworkError(error)}`,
        );
      }
    },
  };
}

/**
 * plugin-retry가 실제로 재시도했다면 그 횟수. 재시도 없이 한 번에 실패했으면 빈 문자열이다.
 *
 * retryCount는 타입 선언에 없는 필드다 — RequestRequestOptions가 인덱스 시그니처로
 * 열어둔 자리에 plugin-retry가 넣는다. 접근 경로는 plugin-retry README를 따랐다.
 */
function retriesOf(error: unknown): string {
  const count = (error as { request?: { request?: { retryCount?: number } } })
    .request?.request?.retryCount;
  return count ? `, 재시도 ${count}회` : "";
}

/**
 * 환경변수로 넘어온 PEM을 되살린다.
 * docker-compose나 .env를 거치면 줄바꿈이 리터럴 `\n` 두 글자로 오는 경우가 흔하다.
 */
export function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.includes("\\n") ? trimmed.replace(/\\n/g, "\n") : trimmed;
}
