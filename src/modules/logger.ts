import type { Logger } from "@/core/ports/logger";

/** 콘솔로 내보내는 기본 구현. 구조화 로그로 바꿀 때 이 파일만 갈아끼운다. */
export const consoleLogger: Logger = {
	debug(message: string): void {
		if (process.env["REVIEWBOT_DEBUG"]) console.debug(`[debug] ${message}`);
	},
	info(message: string): void {
		console.log(message);
	},
	warn(message: string): void {
		console.warn(`[warn] ${message}`);
	},
	error(message: string): void {
		console.error(`[error] ${message}`);
	},
};
