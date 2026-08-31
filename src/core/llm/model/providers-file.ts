import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { log } from "@/core/ports/logger";
import { LlmError } from "./errors";
import type { CooldownPolicy, ProviderSpec } from "./provider";
import { DEFAULT_COOLDOWN } from "./provider";

const PROVIDER_APIS = [
	"openai-completions",
	"google-generative-ai",
	"mistral-conversations",
] as const;

const providerSchema = z.object({
	name: z.string().min(1),
	api: z.enum(PROVIDER_APIS),
	baseUrl: z.string().min(1).optional(),
	model: z.string().min(1),
	apiKey: z.string(),
	maxPromptChars: z.number().int().positive(),
	timeoutMs: z.number().int().positive().default(120_000),
	contextWindow: z.number().int().positive().optional(),
	maxOutputTokens: z.number().int().positive().optional(),
});

const fileSchema = z.object({
	providers: z.array(providerSchema).min(1),
	cooldown: z
		.object({
			rateLimitMs: z.number().int().positive(),
			quotaMs: z.number().int().positive(),
			serverErrorMs: z.number().int().positive(),
		})
		.partial()
		.default({}),
});

export interface ProviderChainConfig {
	providers: ProviderSpec[];
	cooldown: CooldownPolicy;
}

const PLACEHOLDER = /\$\{([A-Z0-9_]+)\}/g;

/**
 * `${VAR}` 를 환경변수 값으로 바꾼다.
 *
 * 값이 없으면 빈 문자열이 남고, 그 provider 는 아래에서 체인에서 빠진다 —
 * 키 하나가 없다고 봇이 안 뜨면 안 된다.
 */
function substitute(
	value: string,
	env: Record<string, string | undefined>,
): string {
	return value.replace(PLACEHOLDER, (_, name: string) => env[name] ?? "");
}

/**
 * providers.yml 을 읽어 체인 설정으로 만든다.
 *
 * 파일을 읽어오는 것은 부른 쪽이 한다 — 여기는 문자열과 환경변수 값만 받는다.
 * 키가 비어 있는 provider 는 빼고 남긴다. 전부 비면 리뷰를 아예 못 하므로 부팅을 멈춘다.
 */
export function parseProvidersFile(
	content: string,
	env: Record<string, string | undefined>,
): ProviderChainConfig {
	let raw: unknown;
	try {
		raw = parseYaml(content);
	} catch (error) {
		throw new LlmError(
			`providers.yml 파싱 실패 — ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const parsed = fileSchema.safeParse(raw);
	if (!parsed.success) {
		const detail = parsed.error.issues
			.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
			.join(", ");
		throw new LlmError(`providers.yml 형식 오류 — ${detail}`);
	}

	const providers: ProviderSpec[] = [];
	for (const entry of parsed.data.providers) {
		const apiKey = substitute(entry.apiKey, env).trim();
		if (!apiKey) {
			log.warn(`${entry.name}: API 키가 비어 있어 체인에서 뺀다`, {
				provider: entry.name,
			});
			continue;
		}
		providers.push({
			...entry,
			apiKey,
			...(entry.baseUrl ? { baseUrl: substitute(entry.baseUrl, env) } : {}),
		});
	}

	if (providers.length === 0)
		throw new LlmError(
			"providers.yml 의 provider 가 모두 키 없이 비어 있다 — 최소 하나는 키가 있어야 한다",
		);

	const names = new Set(providers.map((provider) => provider.name));
	if (names.size !== providers.length)
		throw new LlmError("providers.yml 에 이름이 겹치는 provider 가 있다");

	return {
		providers,
		cooldown: { ...DEFAULT_COOLDOWN, ...parsed.data.cooldown },
	};
}
