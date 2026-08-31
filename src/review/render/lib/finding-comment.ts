import { SEVERITY_LABEL } from "@/review/schema/consts/severity-label";
import type { Finding } from "@/review/schema/model/finding";
import { BOT_MARKER } from "../consts/marker";
import { suggestionBlock } from "./suggestion-block";

export function renderFindingComment(finding: Finding): string {
	const parts = [
		BOT_MARKER,
		`**${SEVERITY_LABEL[finding.severity]}** — ${finding.title}`,
		"",
		finding.detail.trim(),
	];

	parts.push(...suggestionBlock(finding.suggestion));

	return parts.join("\n");
}
