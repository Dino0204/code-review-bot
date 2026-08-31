/**
 * 모델이 준 경로를 리포지토리 안의 상대 경로로 정규화한다.
 *
 * 값을 검증 없이 API에 넘기면 모델이 지어낸 경로로 엉뚱한 요청을 보내게 된다.
 * 해석할 수 없으면 고쳐 쓰지 않고 undefined — 애매한 경로를 추측해 읽어주는 것보다
 * 읽지 못했다고 알리는 편이 낫다.
 */
export function normalizeReadPath(raw: string): string | undefined {
	const cleaned = raw
		.trim()
		.replace(/^['"`]|['"`]$/g, "")
		.replace(/^\/+/, "")
		.replace(/^\.\//, "")
		.replace(/^[ab]\//, "");

	if (!cleaned || cleaned.length > 400) return undefined;
	if (cleaned.includes("\0") || cleaned.includes("\n")) return undefined;
	// `..` 로 리포지토리 밖을 가리키는 경로는 거절한다
	if (cleaned.split("/").some((segment) => segment === "..")) return undefined;
	return cleaned;
}
