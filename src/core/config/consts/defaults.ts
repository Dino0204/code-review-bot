import type { BotConfig } from "../model/bot-config";

export const DEFAULT_CONFIG: BotConfig = {
	// GSML 게이트웨이는 모델 하나만 서빙하고 요청 body의 model 필드를 무시한다.
	baseUrl: "http://ssh.gsmsv.site:26145/v1",
	language: "ko",
	temperature: 0.2,
	// 이 모델은 추론을 끌 수 없고, 그 추론 토큰이 max_tokens를 함께 소비한다.
	// 부족하면 응답이 잘리므로 넉넉히 잡는다 — 잘리면 클라이언트가 예산을 두 배로 올려 한 번 더 시도한다.
	maxOutputTokens: 16384,

	// 컨텍스트 창은 131,072토큰이고 출력도 여기서 나눠 쓴다.
	// 코드 기준 대략 3.5자 ≈ 1토큰이라 이 값이 4만 토큰 언저리다 — 출력 예산을 빼도 여유가 있다.
	maxPromptChars: 140_000,
	maxFiles: 40,
	maxFileChars: 24_000,

	// diff만 주면 헝크 밖을 알 수 없어, 손대지 않은 줄을 새로 생긴 것으로 읽는 오탐이 나온다.
	// 원본을 함께 실으면 프롬프트가 커지지만 그만큼 지적의 근거가 확실해진다.
	includeSources: true,
	maxSourceChars: 16_000,
	maxExtraReads: 6,

	exclude: [
		"**/node_modules/**",
		"**/dist/**",
		"**/build/**",
		"**/out/**",
		"**/.next/**",
		"**/coverage/**",
		"**/vendor/**",
		"**/*.min.js",
		"**/*.map",
		"**/*.snap",
		"**/*.lock",
		"**/package-lock.json",
		"**/pnpm-lock.yaml",
		"**/yarn.lock",
		"**/*.png",
		"**/*.jpg",
		"**/*.jpeg",
		"**/*.gif",
		"**/*.svg",
		"**/*.ico",
		"**/*.pdf",
		"**/*.woff*",
	],
	include: [],

	autoReview: true,
	minSeverity: "minor",
	maxInlineComments: 25,

	triggerPrefix: "/review",

	threadReply: true,
};
