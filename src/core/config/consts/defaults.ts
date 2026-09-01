import type { BotConfig } from "../model/bot-config";

export const DEFAULT_CONFIG: BotConfig = {
	language: "ko",
	temperature: 0.2,
	// 추론을 켜는 모델이 섞여 있고 그 추론 토큰도 여기서 나가므로 넉넉히 잡는다.
	// 모델이 아는 상한을 넘기면 클라이언트가 모델 쪽 값으로 낮춘다.
	maxOutputTokens: 16384,

	// 실제 배치 크기는 이 값과 1순위 provider 예산 중 작은 쪽이다 — 여기 값은
	// provider 가 아무리 커도 넘지 않을 상한이고, 좁히는 것은 providers.yml 이 한다.
	maxPromptChars: 400_000,
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
