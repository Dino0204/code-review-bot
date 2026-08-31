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
	gsmlApiKey: string;
	/** 리포지토리 설정 파일 위에 얹을 값 — 서버 운영자가 환경변수로 지정한다 */
	repoOverrides: Partial<BotConfig>;
}

const schema = z
	.object({
		PORT: z.coerce.number().int().positive().default(3000),
		GITHUB_WEBHOOK_SECRET: z.string(),
		GITHUB_APP_ID: z.string(),
		GITHUB_APP_PRIVATE_KEY: z.string().optional(),
		GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),
		GSML_API_KEY: z.string(),

		REVIEWBOT_BASE_URL: z.string().optional(),
		REVIEWBOT_LANGUAGE: z.string().optional(),
		REVIEWBOT_TRIGGER_PREFIX: z.string().optional(),
		REVIEWBOT_MIN_SEVERITY: z.enum(SEVERITIES).optional(),
		REVIEWBOT_AUTO_REVIEW: z.string().optional(),
		REVIEWBOT_THREAD_REPLY: z.string().optional(),
		REVIEWBOT_INCLUDE_SOURCES: z.string().optional(),
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
 * 빈 문자열은 값이 없는 것으로 본다.
 *
 * compose 는 지정하지 않은 변수를 빈 문자열로 넘긴다 — 그것을 값으로 받으면
 * 기본값 대신 빈 언어·빈 접두사가 설정에 얹힌다.
 */
function present(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value) out[key] = value;
	}
	return out;
}

/** 값이 있을 때만 담는다 — `undefined` 를 얹으면 기본값을 지운다 */
function repoOverrides(env: Env): Partial<BotConfig> {
	const out: Partial<BotConfig> = {};
	if (env.REVIEWBOT_BASE_URL) out.baseUrl = env.REVIEWBOT_BASE_URL;
	if (env.REVIEWBOT_LANGUAGE) out.language = env.REVIEWBOT_LANGUAGE;
	if (env.REVIEWBOT_TRIGGER_PREFIX)
		out.triggerPrefix = env.REVIEWBOT_TRIGGER_PREFIX;
	if (env.REVIEWBOT_MIN_SEVERITY) out.minSeverity = env.REVIEWBOT_MIN_SEVERITY;
	// "false" 만 끄는 값으로 본다 — 켜는 쪽은 어떤 값이든 받는다
	if (env.REVIEWBOT_AUTO_REVIEW)
		out.autoReview = env.REVIEWBOT_AUTO_REVIEW !== "false";
	if (env.REVIEWBOT_THREAD_REPLY)
		out.threadReply = env.REVIEWBOT_THREAD_REPLY !== "false";
	if (env.REVIEWBOT_INCLUDE_SOURCES)
		out.includeSources = env.REVIEWBOT_INCLUDE_SOURCES !== "false";
	if (env.REVIEWBOT_MAX_EXTRA_READS !== undefined)
		out.maxExtraReads = env.REVIEWBOT_MAX_EXTRA_READS;
	if (env.REVIEWBOT_MAX_FILES !== undefined)
		out.maxFiles = env.REVIEWBOT_MAX_FILES;
	return out;
}

/**
 * `ConfigModule` 이 부팅 때 한 번 부른다.
 *
 * 빠진 값이나 형식이 틀린 값은 여기서 부팅을 멈춘다 — 웹훅을 받고 나서 알아채면 이벤트를 잃는다.
 */
export const serverConfig = registerAs("server", (): ServerConfig => {
	const parsed = schema.safeParse(present());
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
		gsmlApiKey: env.GSML_API_KEY,
		repoOverrides: repoOverrides(env),
	};
});
