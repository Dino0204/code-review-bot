/**
 * 웹훅 서버 진입점.
 *
 * GitHub App 웹훅을 직접 받아 리뷰를 돌린다. GitHub Actions 를 쓰지 않으므로
 * Actions 실행 기록도, Actions 분 소모도 없다.
 *
 *   node dist/modules/server/main.js
 */

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { log, setLogger } from "@/core/ports/logger";
import { consoleLogger } from "@/modules/logger";
import { AppModule } from "./app.module";
import { SERVER_ENV, type ServerEnv } from "./config/model/server-env";
import { nestLogger } from "./nest-logger";
import { WEBHOOK_BODY_LIMIT } from "./webhook/consts/limits";

async function bootstrap(): Promise<void> {
	// 로그 구현을 꽂기 전에는 아무 데도 나가지 않는다 — 가장 먼저 한다
	setLogger(consoleLogger);

	const app = await NestFactory.create<NestExpressApplication>(AppModule, {
		// 서명은 원본 바이트에 대해 계산된다. 파싱된 객체로는 검증할 수 없다.
		rawBody: true,
		logger: nestLogger,
	});
	// 본문을 파싱하지 않고 바이트로만 받는다 — 서명을 확인하기 전에 파서가 400 을 내면
	// 서명 없는 요청과 깨진 JSON 이 구분되지 않는다. 파싱은 검증 뒤에 우리가 한다.
	app.useBodyParser("raw", { limit: WEBHOOK_BODY_LIMIT, type: "*/*" });
	// 서버 종류를 굳이 알리지 않는다
	app.disable("x-powered-by");
	// SIGTERM/SIGINT 에 HTTP 서버를 먼저 닫고 onApplicationShutdown 을 부른다
	app.enableShutdownHooks();

	const env = app.get<ServerEnv>(SERVER_ENV);
	await app.listen(env.port);
	log.info(`웹훅 서버 시작 — 포트 ${env.port}`);
}

bootstrap().catch((error: unknown) => {
	log.error(
		`부팅 실패: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exit(1);
});
