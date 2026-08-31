import type { BotConfig } from "@/core/config/model/bot-config";
import type { ChatMessage } from "@/core/llm/model/types";
import { log } from "@/core/ports/logger";
import {
	FINDING_TOOL,
	READ_TOOL,
	SUMMARY_TOOL,
} from "@/core/review/prompt/consts/tools";
import { reviewTools } from "@/core/review/prompt/lib/review-tools";
import { buildReviewMessages } from "@/core/review/prompt/model/review-messages";
import type { ReviewContext } from "@/core/review/prompt/model/types";
import type { ReviewResult } from "@/core/review/schema/model/review-result";
import { MAX_NUDGES } from "../consts/nudges";
import { collectToolCalls } from "../lib/collect-tool-calls";
import { serveReads } from "./serve-reads";
import type { RunnerDeps } from "./types";

/** 도구를 부르지 않은 응답에 붙이는 교정 지시. 형식은 도구 블록에 이미 있으므로 되풀이하지 않는다. */
function retryNudge(): string {
	return [
		"방금 응답에는 도구 호출이 없었다. 본문만 쓴 응답은 전달되지 않고 버려진다.",
		`같은 리뷰를 ${SUMMARY_TOOL} 호출 한 번과, 지적마다 ${FINDING_TOOL} 호출로 다시 제출하라.`,
		"<tool_call> 블록 밖에는 아무것도 쓰지 마라.",
	].join("\n");
}

/**
 * 모델에게 도구를 제시해 리뷰 결과를 받는다.
 *
 * 모델이 `read_file` 을 부르면 그 파일을 읽어 대화에 실어주고 다시 묻는다 —
 * diff에 없는 코드가 판단에 필요할 때 추측 대신 확인하게 하려는 것이다.
 * 리뷰 도구를 부른 시점에 대화가 끝나므로, 읽기 요청이 계속되면 상한에서 멈춘다.
 *
 * 도구 주입은 그래머 강제가 아니라 프롬프트 기반이므로 모델이 도구를 아예 안 부를 수 있다.
 * 그 경우 한 번 더 시도하고, 그래도 못 받으면 모델이 쓴 본문을 요약으로 대신 실어
 * 인라인 코멘트 없이도 리뷰가 통째로 사라지지 않게 한다.
 */
export async function requestReview(
	deps: RunnerDeps,
	context: ReviewContext,
	config: BotConfig,
): Promise<ReviewResult> {
	const { llm, github } = deps;
	const tools = reviewTools(config);
	const options = {
		temperature: config.temperature,
		maxTokens: config.maxOutputTokens,
	};

	const conversation: ChatMessage[] = buildReviewMessages(context);
	// diff에 실린 파일은 이미 원본까지 넘겼으므로 다시 읽어줄 이유가 없다
	const served = new Set(context.diffFiles.map((file) => file.path));
	let reads = 0;
	let nudges = 0;
	let lastText = "";

	const maxRounds = MAX_NUDGES + config.maxExtraReads + 1;
	for (let round = 1; round <= maxRounds; round++) {
		const { toolCalls, text, raw } = await llm.chatWithTools(
			conversation,
			tools,
			options,
		);

		const readCalls = toolCalls.filter((call) => call.name === READ_TOOL);
		const reviewCalls = toolCalls.filter((call) => call.name !== READ_TOOL);

		// 리뷰를 제출했으면 그것으로 끝낸다. 읽기 요청을 함께 부른 경우 읽어주지 않는다 —
		// 이미 판단을 내려놓고 부른 것이라 한 번 더 물어도 같은 답이 돌아온다.
		if (reviewCalls.length > 0) {
			if (readCalls.length > 0) {
				log.warn(
					`리뷰 제출과 ${READ_TOOL} 을 함께 호출해 읽기 요청은 무시한다`,
				);
			}
			return collectToolCalls(reviewCalls);
		}

		if (readCalls.length > 0) {
			const { message, granted } = await serveReads(
				github,
				readCalls,
				context,
				config,
				served,
				reads,
			);
			reads += granted;
			conversation.push({ role: "assistant", content: raw });
			conversation.push({ role: "user", content: message });
			continue;
		}

		lastText = text;
		nudges++;
		log.warn(`모델이 도구를 호출하지 않았다 (${nudges}/${MAX_NUDGES})`);
		if (nudges >= MAX_NUDGES) break;

		// 재시도는 같은 프롬프트를 그대로 다시 보내는 대신 무엇이 잘못됐는지 알려준다.
		conversation.push({ role: "assistant", content: raw });
		conversation.push({ role: "user", content: retryNudge() });
	}

	return {
		summary: `_(모델이 도구를 호출하지 않아 본문을 그대로 싣는다 — 인라인 코멘트는 없다)_\n\n${lastText}`,
		findings: [],
	};
}
