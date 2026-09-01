import { readFileSync } from "node:fs";
import { registerAs } from "@nestjs/config";
import { z } from "zod";
import type { BotConfig } from "@/core/config/model/bot-config";
import { SEVERITIES } from "@/core/config/model/severity";

/** 부팅에 필요한 설정. 환경변수를 읽는 곳은 이 파일 하나뿐이다. */
export interface ServerConfig {
	port: number;
	webhookSecret: string;
	githubAppId: string;
	githubPrivateKey: string;
	/** provider 체인 정의 파일의 경로 */
	providersFile: string;
	/** 큐와 리뷰 상태를 담아두는 Redis 주소 */
	redisUrl: string;
	/** 리포지토리 설정 파일 위에 얹을 값 — 서버 운영자가 환경변수로 지정한다 */
	repoOverrides: Partial<BotConfig>;
}

/**
 * 빈 문자열은 값을 준 것으로 치지 않는다.
 *
 * `GITHUB_WEBHOOK_SECRET=` 가 그냥 통과하면 빈 키로 HMAC 을 계산한다 — 서명을 누구나
 * 만들 수 있으니 웹훅 인증이 없는 것과 같다. 조용히 넘어가느니 부팅에서 멈추는 편이 낫다.
 */
const text = z.string().min(1);

/** 켜는 값은 무엇이든 받고 `"false"` 만 끄는 값으로 본다 */
const flag = z
	.string()
	.transform((value) => value !== "false")
	.optional();

const schema = z
	.object({
		PORT: z.coerce.number().int().positive().default(3000),
		GITHUB_WEBHOOK_SECRET: text,
		GITHUB_APP_ID: text,
		GITHUB_APP_PRIVATE_KEY: text.optional(),
		GITHUB_APP_PRIVATE_KEY_PATH: text.optional(),
		PROVIDERS_FILE: text.default("./providers.yml"),
		// 로거는 DI 밖에서 이 값을 직접 읽는다(`modules/logger.ts`). 여기서는 형식만 잡는다 —
		// 오타를 넣으면 조용히 text 로 도는 대신 부팅에서 멈춘다.
		LOG_FORMAT: z.enum(["text", "json"]).default("text"),
		// compose 안에서는 서비스 이름으로 붙는다. 로컬에서 그냥 띄우면 기본값이 맞는다.
		REDIS_URL: text.default("redis://127.0.0.1:6379"),

		REVIEWBOT_LANGUAGE: text.optional(),
		REVIEWBOT_TRIGGER_PREFIX: text.optional(),
		REVIEWBOT_MIN_SEVERITY: z.enum(SEVERITIES).optional(),
		REVIEWBOT_AUTO_REVIEW: flag,
		REVIEWBOT_THREAD_REPLY: flag,
		REVIEWBOT_INCLUDE_SOURCES: flag,
		REVIEWBOT_MAX_EXTRA_READS: z.coerce.number().int().nonnegative().optional(),
		REVIEWBOT_MAX_FILES: z.coerce.number().int().positive().optional(),
	})
	// 개인키는 값으로도, 파일 경로로도 줄 수 있다. 도커에서는 시크릿 파일 마운트가 편하다.
	.refine(
		(env) => env.GITHUB_APP_PRIVATE_KEY ?? env.GITHUB_APP_PRIVATE_KEY_PATH,
		{
			path: ["GITHUB_APP_PRIVATE_KEY"],
			error:
				"GITHUB_APP_PRIVATE_KEY 또는 GITHUB_APP_PRIVATE_KEY_PATH 가 필요하다",
		},
	);

type Env = z.infer<typeof schema>;

/**
 * 환경변수 이름을 설정 필드 이름에 붙인다.
 *
 * 값이 없는 키는 걷어낸다 — `loadConfig` 가 덮어쓸 값을 그대로 펼치므로,
 * `undefined` 가 든 키를 넘기면 기본값이 살아남지 못하고 지워진다.
 */
function repoOverrides(env: Env): Partial<BotConfig> {
	const mapped = {
		language: env.REVIEWBOT_LANGUAGE,
		triggerPrefix: env.REVIEWBOT_TRIGGER_PREFIX,
		minSeverity: env.REVIEWBOT_MIN_SEVERITY,
		autoReview: env.REVIEWBOT_AUTO_REVIEW,
		threadReply: env.REVIEWBOT_THREAD_REPLY,
		includeSources: env.REVIEWBOT_INCLUDE_SOURCES,
		maxExtraReads: env.REVIEWBOT_MAX_EXTRA_READS,
		maxFiles: env.REVIEWBOT_MAX_FILES,
	};

	return Object.fromEntries(
		Object.entries(mapped).filter(([, value]) => value !== undefined),
	) as Partial<BotConfig>;
}

/**
 * `ConfigModule` 이 부팅 때 한 번 부른다.
 *
 * 빠진 값이나 형식이 틀린 값은 여기서 부팅을 멈춘다 — 웹훅을 받고 나서 알아채면 이벤트를 잃는다.
 */
export const serverConfig = registerAs("server", (): ServerConfig => {
	const parsed = schema.safeParse(process.env);
	if (!parsed.success) {
		const detail = parsed.error.issues
			.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
			.join(", ");
		throw new Error(`환경변수 검증 실패 — ${detail}`);
	}

	const env = parsed.data;
	const privateKey = env.GITHUB_APP_PRIVATE_KEY_PATH
		? readFileSync(env.GITHUB_APP_PRIVATE_KEY_PATH, "utf8")
		: (env.GITHUB_APP_PRIVATE_KEY ?? "");

	return {
		port: env.PORT,
		webhookSecret: env.GITHUB_WEBHOOK_SECRET,
		githubAppId: env.GITHUB_APP_ID,
		githubPrivateKey: privateKey,
		providersFile: env.PROVIDERS_FILE,
		redisUrl: env.REDIS_URL,
		repoOverrides: repoOverrides(env),
	};
});
