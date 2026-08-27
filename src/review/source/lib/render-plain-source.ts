/**
 * diff에 없는 파일을 통째로 싣는다. `read_file` 로 모델이 따로 요청한 파일용이다.
 *
 * 헝크가 없어 어디를 남길지 고를 수 없으므로 앞에서부터 예산만큼 자른다 —
 * 대부분의 파일은 import와 주요 선언이 위쪽에 있어 앞부분이 맥락을 더 많이 담는다.
 */
export function renderPlainSource(
	path: string,
	content: string,
	maxChars: number,
): string {
	const lines = content.split("\n");
	const kept: string[] = [];
	let used = 0;
	for (const line of lines) {
		if (used + line.length + 1 > maxChars) break;
		kept.push(line);
		used += line.length + 1;
	}

	const scope =
		kept.length === lines.length
			? `전체 ${lines.length}줄`
			: `전체 ${lines.length}줄 중 앞 ${kept.length}줄`;
	const width = String(kept.length).length;
	const body = kept
		.map((line, index) => `${String(index + 1).padStart(width, " ")} | ${line}`)
		.join("\n");

	return `### ${path} (${scope})\n\`\`\`\n${body}\n\`\`\``;
}
