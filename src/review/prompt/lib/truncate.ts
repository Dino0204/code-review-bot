/** 프롬프트가 컨텍스트 창을 넘지 않도록 뒤를 잘라낸다 */
export function truncate(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n… (이후 생략)`;
}
