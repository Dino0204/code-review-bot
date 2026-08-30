/** 요청 본문을 통째로 읽는다. 서명은 원본 바이트에 대해 계산되므로 파싱 전에 보관해야 한다. */
export async function readBody(
	stream: AsyncIterable<Buffer | string>,
	limitBytes = 25 * 1024 * 1024,
): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of stream) {
		const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
		total += buffer.length;
		if (total > limitBytes) throw new Error("웹훅 본문이 너무 크다");
		chunks.push(buffer);
	}
	return Buffer.concat(chunks);
}
