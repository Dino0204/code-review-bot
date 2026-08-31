import { readFileSync } from "node:fs";
import type { ServerEnv } from "../model/server-env";

const DEFAULT_PORT = 3000;

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} 환경변수가 필요하다`);
	return value;
}

/** 개인키는 값으로도, 파일 경로로도 줄 수 있다. 도커에서는 시크릿 파일 마운트가 편하다. */
function privateKey(): string {
	const path = process.env["GITHUB_APP_PRIVATE_KEY_PATH"];
	if (path) return readFileSync(path, "utf8");
	return required("GITHUB_APP_PRIVATE_KEY");
}

/** 빠진 값이 있으면 부팅을 멈춘다 — 웹훅을 받고 나서 알아채면 이벤트를 잃는다 */
export function loadServerEnv(): ServerEnv {
	return {
		port: Number(process.env["PORT"] ?? DEFAULT_PORT),
		webhookSecret: required("GITHUB_WEBHOOK_SECRET"),
		githubAppId: required("GITHUB_APP_ID"),
		githubPrivateKey: privateKey(),
		gsmlApiKey: required("GSML_API_KEY"),
	};
}
