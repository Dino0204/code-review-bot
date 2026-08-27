import { DEFAULT_CONFIG } from "../consts/defaults";
import type { BotConfig } from "../model/bot-config";
import type { Severity } from "../model/severity";
import { SEVERITIES } from "../model/severity";

function coerceStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.filter((v): v is string => typeof v === "string");
}

export function pickFileConfig(raw: unknown): Partial<BotConfig> {
	if (!raw || typeof raw !== "object") return {};
	const r = raw as Record<string, unknown>;
	const out: Partial<BotConfig> = {};

	const strings = ["baseUrl", "language", "triggerPrefix"] as const;
	for (const key of strings) {
		if (typeof r[key] === "string") out[key] = r[key] as string;
	}

	const numbers = [
		"temperature",
		"maxOutputTokens",
		"maxPromptChars",
		"maxFiles",
		"maxFileChars",
		"maxSourceChars",
		"maxExtraReads",
		"maxInlineComments",
	] as const;
	for (const key of numbers) {
		if (typeof r[key] === "number" && Number.isFinite(r[key]))
			out[key] = r[key] as number;
	}

	if (typeof r["autoReview"] === "boolean") out.autoReview = r["autoReview"];
	if (typeof r["threadReply"] === "boolean") out.threadReply = r["threadReply"];
	if (typeof r["includeSources"] === "boolean")
		out.includeSources = r["includeSources"];

	const exclude = coerceStringArray(r["exclude"]);
	if (exclude) out.exclude = [...DEFAULT_CONFIG.exclude, ...exclude];
	const include = coerceStringArray(r["include"]);
	if (include) out.include = include;

	if (
		typeof r["minSeverity"] === "string" &&
		(SEVERITIES as readonly string[]).includes(r["minSeverity"])
	) {
		out.minSeverity = r["minSeverity"] as Severity;
	}

	return out;
}
