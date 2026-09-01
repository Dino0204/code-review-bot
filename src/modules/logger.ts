import type { LogFields, Logger } from "@/core/ports/logger";

type Level = "debug" | "info" | "warn" | "error";

/** 값이 없는 필드는 싣지 않는다 — 로그마다 키 목록이 달라지는 편이 `null` 이 늘어서는 것보다 낫다 */
function present(
	fields: LogFields,
): Array<[string, string | number | boolean]> {
	return Object.entries(fields).filter(
		(entry): entry is [string, string | number | boolean] =>
			entry[1] !== undefined,
	);
}

/** 사람이 읽는 형식 — 문장 뒤에 `키=값` 을 붙인다 */
function text(level: Level, message: string, fields?: LogFields): string {
	const prefix = level === "info" ? "" : `[${level}] `;
	const tail = fields ? present(fields) : [];
	return (
		prefix +
		message +
		(tail.length
			? ` | ${tail.map(([key, value]) => `${key}=${value}`).join(" ")}`
			: "")
	);
}

/**
 * 수집기가 읽는 형식 — 한 줄에 JSON 하나.
 *
 * 문장은 `msg` 에 그대로 두고 필드를 최상위에 편다. "google 이 몇 번 429 를 냈나" 같은
 * 질문에 문장을 파싱하지 않고 답할 수 있게 하려는 것이다.
 */
function json(level: Level, message: string, fields?: LogFields): string {
	return JSON.stringify({
		ts: new Date().toISOString(),
		level,
		msg: message,
		...(fields ? Object.fromEntries(present(fields)) : {}),
	});
}

/**
 * 콘솔로 내보내는 구현.
 *
 * `LOG_FORMAT` 과 `REVIEWBOT_DEBUG` 는 환경변수에서 직접 읽는다 — 로거는 Nest 가 뜨기
 * 전에 꽂아야 해서 DI 밖에 있다. 값이 틀렸는지는 `server-config` 의 스키마가 부팅에서 잡는다.
 */
export function createLogger(
	env: Record<string, string | undefined> = process.env,
): Logger {
	const format = env["LOG_FORMAT"] === "json" ? json : text;
	const debugOn = Boolean(env["REVIEWBOT_DEBUG"]);

	return {
		debug(message: string, fields?: LogFields): void {
			if (debugOn) console.debug(format("debug", message, fields));
		},
		info(message: string, fields?: LogFields): void {
			console.log(format("info", message, fields));
		},
		warn(message: string, fields?: LogFields): void {
			console.warn(format("warn", message, fields));
		},
		error(message: string, fields?: LogFields): void {
			console.error(format("error", message, fields));
		},
	};
}

export const consoleLogger: Logger = createLogger();
