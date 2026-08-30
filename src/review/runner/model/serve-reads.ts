import { minimatch } from "minimatch";
import type { BotConfig } from "../../../config/model/bot-config";
import type { GitHubClient } from "../../../github/client/model/types";
import type { ToolCall } from "../../../llm/model/types";
import { log } from "../../../logger";
import { READ_TOOL } from "../../prompt/consts/tools";
import type { ReviewContext } from "../../prompt/model/types";
import { renderPlainSource } from "../../source/lib/render-plain-source";
import { normalizeReadPath } from "../lib/normalize-read-path";

/**
 * 모델이 요청한 파일을 읽어 다음 차례에 실어줄 메시지를 만든다.
 *
 * 경로는 모델이 지어낸 문자열이므로 그대로 쓰지 않는다 — 리포지토리 밖을 가리키거나
 * 제외 대상인 경로는 거절하고, 거절한 이유도 함께 알려준다. 아무 말 없이 비워 보내면
 * 모델이 같은 파일을 계속 다시 요청한다.
 */
export async function serveReads(
	github: GitHubClient,
	calls: ToolCall[],
	context: ReviewContext,
	config: BotConfig,
	served: Set<string>,
	used: number,
): Promise<{ message: string; granted: number }> {
	const parts: string[] = [];
	let granted = 0;

	for (const call of calls) {
		const requested = call.arguments["path"] ?? "";
		const path = normalizeReadPath(requested);

		if (!path) {
			parts.push(`\`${requested}\` — 경로를 해석할 수 없어 읽지 않았다.`);
			continue;
		}
		if (served.has(path)) {
			parts.push(`\`${path}\` — 이미 위에 실려 있다. 그 내용을 보라.`);
			continue;
		}
		if (used + granted >= config.maxExtraReads) {
			parts.push(
				`\`${path}\` — 읽기 상한(${config.maxExtraReads}개)에 도달해 읽지 않았다. 지금 있는 자료로 리뷰를 제출하라.`,
			);
			continue;
		}
		if (
			config.exclude.some((pattern) => minimatch(path, pattern, { dot: true }))
		) {
			parts.push(`\`${path}\` — 리뷰에서 제외된 경로라 읽지 않았다.`);
			continue;
		}

		let content: string | undefined;
		try {
			content = await github.readFile(path, context.pr.headSha);
		} catch (error) {
			log.warn(
				`${READ_TOOL} 실패: ${path} — ${error instanceof Error ? error.message : String(error)}`,
			);
			parts.push(`\`${path}\` — 읽는 중 오류가 나 내용을 가져오지 못했다.`);
			continue;
		}
		if (content === undefined) {
			parts.push(`\`${path}\` — 이 리포지토리에 없는 파일이다.`);
			continue;
		}

		served.add(path);
		granted++;
		log.info(`${READ_TOOL}: ${path} (${content.length}자)`);
		parts.push(renderPlainSource(path, content, config.maxSourceChars));
	}

	const remaining = config.maxExtraReads - (used + granted);
	const message = [
		`## ${READ_TOOL} 결과`,
		"",
		...parts,
		"",
		remaining > 0
			? `더 읽을 수 있는 파일은 ${remaining}개다. 필요 없으면 지금 리뷰를 제출하라.`
			: "읽기 상한에 도달했다. 지금 있는 자료로 리뷰를 제출하라.",
	].join("\n");

	return { message, granted };
}
