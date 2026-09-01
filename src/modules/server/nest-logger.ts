import type { LoggerService } from "@nestjs/common";
import { log } from "@/core/ports/logger";

/** Nest 는 부팅 실패를 Error 객체째로 넘긴다 — 직렬화하면 `{}` 가 되어 원인이 사라진다 */
function describe(message: unknown): string {
	if (typeof message === "string") return message;
	if (message instanceof Error) return message.stack ?? message.message;
	return JSON.stringify(message) ?? String(message);
}

function line(message: unknown, params: unknown[]): string {
	// Nest 는 마지막 인자로 컨텍스트(클래스 이름)를 넘긴다 — 앞에 붙여 출처를 남긴다
	const context = params.length > 0 ? params[params.length - 1] : undefined;
	const text = describe(message);
	return typeof context === "string" ? `[${context}] ${text}` : text;
}

/**
 * Nest 프레임워크 로그를 Logger 포트로 흘린다.
 *
 * Nest 기본 로거를 그대로 두면 프레임워크 로그만 형식이 달라진다. 이 브릿지 덕분에
 * 출력 형식은 `modules/logger.ts` 하나가 정한다 — `LOG_FORMAT=json` 이면 프레임워크
 * 로그도 같은 JSON 줄로 나간다.
 */
export const nestLogger: LoggerService = {
	log: (message: unknown, ...params: unknown[]) =>
		log.info(line(message, params)),
	error: (message: unknown, ...params: unknown[]) =>
		log.error(line(message, params)),
	warn: (message: unknown, ...params: unknown[]) =>
		log.warn(line(message, params)),
	debug: (message: unknown, ...params: unknown[]) =>
		log.debug(line(message, params)),
	verbose: (message: unknown, ...params: unknown[]) =>
		log.debug(line(message, params)),
};
