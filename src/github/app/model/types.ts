export interface AppCredentials {
	appId: string;
	privateKey: string;
}

export interface GitHubApp {
	installationToken(installationId: number): Promise<string>;
}
