/**
 * 로그 포트.
 *
 * 도메인 로직도 무슨 일이 있었는지는 남겨야 한다 — 지적을 몇 건 버렸는지, 왜 버렸는지는
 * 밖에서 다시 계산할 수 없다. 다만 그것을 콘솔에 어떻게 찍을지는 도메인이 알 바가 아니므로
 * 인터페이스만 여기 두고 구현은 modules 가 넣는다.
 *
 * 구현을 넣지 않으면 아무 데도 쓰지 않는다 — 테스트에서 로그가 새어나오지 않게 하려는 것이다.
 */
export interface Logger {
	debug(message: string): void;
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

const silent: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

let current: Logger = silent;

/** 부팅 시 한 번 구현을 꽂는다 */
export function setLogger(logger: Logger): void {
	current = logger;
}

/** 호출 시점에 현재 구현으로 넘긴다 — 부팅 순서에 상관없이 import 할 수 있다 */
export const log: Logger = {
	debug: (message) => current.debug(message),
	info: (message) => current.info(message),
	warn: (message) => current.warn(message),
	error: (message) => current.error(message),
};
