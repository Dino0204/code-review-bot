import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createGitHubApp } from "../../github/app/api/create-github-app";
import { log } from "../../logger";
import { handle, send } from "../api/http-server";
import type { HandlerDeps } from "../handler/model/types";
import { createReviewQueue } from "../queue/model/create-review-queue";

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

export function main(): void {
	const webhookSecret = required("GITHUB_WEBHOOK_SECRET");
	const gsmlApiKey = required("GSML_API_KEY");

	const deps: HandlerDeps = {
		app: createGitHubApp({
			appId: required("GITHUB_APP_ID"),
			privateKey: privateKey(),
		}),
		gsmlApiKey,
	};

	const queue = createReviewQueue();
	const port = Number(process.env["PORT"] ?? 3000);

	const server = createServer((request, response) => {
		handle(request, response, deps, queue, webhookSecret).catch(
			(error: unknown) => {
				log.error(
					`요청 처리 실패: ${error instanceof Error ? error.message : String(error)}`,
				);
				send(response, 500, "internal error");
			},
		);
	});

	server.listen(port, () => {
		log.info(`웹훅 서버 시작 — 포트 ${port}`);
	});

	for (const signal of ["SIGTERM", "SIGINT"] as const) {
		process.on(signal, () => {
			log.info(
				`${signal} 수신 — 새 요청을 받지 않는다 (진행 중 리뷰 ${queue.size}건)`,
			);
			server.close(() => process.exit(0));
		});
	}
}
