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

function retriesOf(error: any): string {
  const count = error.request?.request?.retryCount;
  return count ? `, 재시도 ${count}회` : "";
}

export function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.includes("\\n") ? trimmed.replace(/\\n/g, "\n") : trimmed;
}
