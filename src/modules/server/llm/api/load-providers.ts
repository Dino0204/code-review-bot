import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LlmError } from "@/core/llm/model/errors";
import type { ProviderChainConfig } from "@/core/llm/model/providers-file";
import { parseProvidersFile } from "@/core/llm/model/providers-file";

/**
 * providers.yml 을 읽어 체인 설정으로 만든다.
 *
 * 부팅에서 한 번만 부른다 — 파일이 없거나 키가 하나도 없으면 여기서 멈춘다.
 * 웹훅을 받고 나서 알아채면 이벤트를 잃는다.
 */
export function loadProviders(path: string): ProviderChainConfig {
	const absolute = resolve(path);
	let content: string;
	try {
		content = readFileSync(absolute, "utf8");
	} catch (error) {
		throw new LlmError(
			`providers.yml 을 읽지 못했다 (${absolute}) — ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return parseProvidersFile(content, process.env);
}
