import { BOT_MARKER } from "../consts/marker";

export function renderPlainComment(
	title: string,
	body: string,
	meta?: { model: string },
): string {
	const parts = [BOT_MARKER, `## ${title}`, "", body.trim()];
	if (meta) {
		parts.push("", "---", `<sub>모델 \`${meta.model}\`</sub>`);
	}
	return parts.join("\n");
}
