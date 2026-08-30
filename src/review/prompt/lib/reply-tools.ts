import type { BotConfig } from "../../../config/model/bot-config";
import type { ToolDefinition } from "../../../llm/model/types";
import { REPLY_TOOL } from "../consts/tools";
import { languageName } from "./language-name";

export function replyTools(config: BotConfig): ToolDefinition[] {
	return [
		{
			name: REPLY_TOOL,
			description:
				"인라인 리뷰 쓰레드에 남길 답변을 제출한다. 정확히 한 번 호출한다.",
			parameters: {
				type: "object",
				properties: {
					reply: {
						type: "string",
						description: `쓰레드에 남길 답변. 마크다운 3~8줄, ${languageName(config.language)}.`,
					},
					suggestion: {
						type: "string",
						description:
							"쓰레드가 가리키는 줄을 그대로 대체할 수 있는 완성된 코드. 아니면 생략한다.",
					},
				},
				required: ["reply"],
			},
		},
	];
}
