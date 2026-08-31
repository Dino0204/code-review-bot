import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";
import { retry } from "@octokit/plugin-retry";
import { RequestError } from "@octokit/request-error";
import { describeNetworkError } from "@/net";
import { normalizePrivateKey } from "../lib/normalize-private-key";
import type { AppCredentials, GitHubApp } from "../model/types";

const RETRIES = 2;

const RetryingOctokit = Octokit.plugin(retry);

function retriesOf(error: unknown): string {
	if (!(error instanceof RequestError)) return "";
	const count = error.request.request?.retryCount;
	return count ? `, 재시도 ${count}회` : "";
}

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
