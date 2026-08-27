/**
 * 사람이 지금 하는 말만 남긴다 — 인용문과 코드 블록은 걷어낸다.
 *
 * 봇 코멘트를 인용해 답하면 인용 안에 남은 명령이나 멘션이 그대로 다시 트리거된다.
 */
export function speakingLines(body: string): string[] {
	const lines: string[] = [];
	let inFence = false;

	for (const raw of body.split("\n")) {
		const line = raw.trim();
		if (line.startsWith("```") || line.startsWith("~~~")) {
			inFence = !inFence;
			continue;
		}
		if (inFence || line.startsWith(">")) continue;
		lines.push(line);
	}

	return lines;
}
