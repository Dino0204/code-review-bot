import { speakingLines } from "./speaking-lines";

export function hasReviewTrigger(
	body: string,
	triggerPrefix = "/review",
): boolean {
	return speakingLines(body).some(
		(line) => line === triggerPrefix || line.startsWith(`${triggerPrefix} `),
	);
}
