import { minimatch } from "minimatch";
import type { BotConfig } from "@/core/config/model/bot-config";
import type { GitHubClient } from "@/core/github/port";
import type { ChatMessage, ToolCall } from "@/core/llm/model/types";
import { log } from "@/core/ports/logger";
import { READ_TOOL } from "@/core/review/prompt/consts/tools";
import type { ReviewContext } from "@/core/review/prompt/model/types";
import { renderPlainSource } from "@/core/review/source/lib/render-plain-source";
import { normalizeReadPath } from "../lib/normalize-read-path";

/**
 * 모델이 요청한 파일을 읽어 도구 결과로 돌려준다.
 *
 * 호출 하나에 결과 하나를 짝지어 붙인다 — 네이티브 tool calling 은 부른 도구마다
 * 결과가 와야 대화가 이어진다. 거절한 요청에도 이유를 담아 돌려준다. 아무 말 없이
 * 비워 보내면 모델이 같은 파일을 계속 다시 요청한다.
 *
 * 경로는 모델이 지어낸 문자열이므로 그대로 쓰지 않는다 — 리포지토리 밖을 가리키거나
 * 제외 대상인 경로는 거절한다.
 */
export async function serveReads(
	github: GitHubClient,
	calls: ToolCall[],
	context: ReviewContext,
	config: BotConfig,
	served: Set<string>,
	used: number,
): Promise<{ messages: ChatMessage[]; granted: number }> {
	const results: Array<{ call: ToolCall; body: string }> = [];
	let granted = 0;

	for (const call of calls) {
		const requested = String(call.arguments["path"] ?? "");
		const path = normalizeReadPath(requested);
		const reject = (reason: string): void => {
			results.push({ call, body: `\`${requested}\` — ${reason}` });
		};

		if (!path) {
			reject("경로를 해석할 수 없어 읽지 않았다.");
			continue;
		}
		if (served.has(path)) {
			reject("이미 위에 실려 있다. 그 내용을 보라.");
			continue;
		}
		if (used + granted >= config.maxExtraReads) {
			reject(
				`읽기 상한(${config.maxExtraReads}개)에 도달해 읽지 않았다. 지금 있는 자료로 리뷰를 제출하라.`,
			);
			continue;
		}
		if (
			config.exclude.some((pattern) => minimatch(path, pattern, { dot: true }))
		) {
			reject("리뷰에서 제외된 경로라 읽지 않았다.");
			continue;
		}

		let content: string | undefined;
		try {
			content = await github.readFile(path, context.pr.headSha);
		} catch (error) {
			log.warn(
				`${READ_TOOL} 실패: ${path} — ${error instanceof Error ? error.message : String(error)}`,
			);
			reject("읽는 중 오류가 나 내용을 가져오지 못했다.");
			continue;
		}
		if (content === undefined) {
			reject("이 리포지토리에 없는 파일이다.");
			continue;
		}

		served.add(path);
		granted++;
		log.info(`${READ_TOOL}: ${path} (${content.length}자)`, {
			path,
			chars: content.length,
		});
		results.push({
			call,
			body: renderPlainSource(path, content, config.maxSourceChars),
		});
	}

	// 남은 예산은 마지막 결과에 붙인다 — 도구 결과 뒤에 사용자 차례를 한 줄 더 끼우면
	// provider 마다 허용 여부가 갈린다.
	const remaining = config.maxExtraReads - (used + granted);
	const last = results.at(-1);
	if (last)
		last.body += `\n\n${
			remaining > 0
				? `더 읽을 수 있는 파일은 ${remaining}개다. 필요 없으면 지금 리뷰를 제출하라.`
				: "읽기 상한에 도달했다. 지금 있는 자료로 리뷰를 제출하라."
		}`;

	return {
		messages: results.map(({ call, body }) => ({
			role: "toolResult" as const,
			toolCallId: call.id,
			toolName: call.name,
			content: body,
		})),
		granted,
	};
}
