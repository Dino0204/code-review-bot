import { BOT_MARKER } from "../consts/marker";

export function renderError(message: string, title = "코드 리뷰 실패"): string {
	return [
		BOT_MARKER,
		`## ⚠️ ${title}`,
		"",
		"```",
		message.slice(0, 1500),
		"```",
	].join("\n");
}
