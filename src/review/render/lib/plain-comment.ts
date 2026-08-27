import { BOT_MARKER } from "../consts/marker";

export function renderPlainComment(title: string, body: string): string {
	return [BOT_MARKER, `## ${title}`, "", body.trim()].join("\n");
}
