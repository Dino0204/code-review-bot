export function stripFence(code: string): string {
	const match = /^\s*```[\w-]*\n([\s\S]*?)\n?```\s*$/.exec(code);
	return (match?.[1] ?? code).replace(/\s+$/, "");
}

function longestBacktickRun(text: string): number {
	let longest = 0;
	for (const match of text.matchAll(/`+/g))
		longest = Math.max(longest, match[0].length);
	return longest;
}

/** GitHub의 "이 코드로 교체" 블록. 적용할 코드가 없으면 아무것도 붙이지 않는다 */
export function suggestionBlock(suggestion: string | undefined): string[] {
	const code = suggestion ? stripFence(suggestion).replace(/^\n+/, "") : "";
	if (!code.trim()) return [];

	// 코드 안의 백틱보다 긴 펜스를 써야 블록이 중간에 끊기지 않는다
	const fence = "`".repeat(Math.max(3, longestBacktickRun(code) + 1));
	return ["", `${fence}suggestion`, code, fence];
}
