/**
 * 부팅에 필요한 환경 설정.
 *
 * `process.env` 를 읽는 곳을 여기 하나로 모은다 — 어디서 무엇을 요구하는지 한눈에 보이고,
 * 나머지 코드는 값을 주입받으므로 환경변수를 몰라도 된다.
 */
export interface ServerEnv {
	port: number;
	webhookSecret: string;
	githubAppId: string;
	githubPrivateKey: string;
	gsmlApiKey: string;
}

/** DI 토큰 — 인터페이스는 런타임에 없으므로 값으로 주입한다 */
export const SERVER_ENV = "SERVER_ENV";
