import type { BotConfig } from "../model/bot-config";
import type { Severity } from "../model/severity";
import { SEVERITIES } from "../model/severity";

export function envOverrides(): Partial<BotConfig> {
	const env = process.env;
	const out: Partial<BotConfig> = {};
	if (env["REVIEWBOT_BASE_URL"]) out.baseUrl = env["REVIEWBOT_BASE_URL"];
	if (env["REVIEWBOT_LANGUAGE"]) out.language = env["REVIEWBOT_LANGUAGE"];
	if (env["REVIEWBOT_TRIGGER_PREFIX"])
		out.triggerPrefix = env["REVIEWBOT_TRIGGER_PREFIX"];
	if (
		env["REVIEWBOT_MIN_SEVERITY"] &&
		(SEVERITIES as readonly string[]).includes(env["REVIEWBOT_MIN_SEVERITY"])
	) {
		out.minSeverity = env["REVIEWBOT_MIN_SEVERITY"] as Severity;
	}
	if (env["REVIEWBOT_AUTO_REVIEW"])
		out.autoReview = env["REVIEWBOT_AUTO_REVIEW"] !== "false";
	if (env["REVIEWBOT_THREAD_REPLY"])
		out.threadReply = env["REVIEWBOT_THREAD_REPLY"] !== "false";
	if (env["REVIEWBOT_INCLUDE_SOURCES"])
		out.includeSources = env["REVIEWBOT_INCLUDE_SOURCES"] !== "false";
	if (env["REVIEWBOT_MAX_EXTRA_READS"]) {
		const n = Number(env["REVIEWBOT_MAX_EXTRA_READS"]);
		if (Number.isFinite(n)) out.maxExtraReads = n;
	}
	if (env["REVIEWBOT_MAX_FILES"]) {
		const n = Number(env["REVIEWBOT_MAX_FILES"]);
		if (Number.isFinite(n)) out.maxFiles = n;
	}
	return out;
}
