import { renderFileDiff } from "@/github/diff/lib/render-file-diff";
import type { ChatMessage } from "@/llm/model/types";
import { renderFileSource } from "@/review/source/lib/render-file-source";
import type { FileSource } from "@/review/source/model/types";
import { FINDING_TOOL, SUMMARY_TOOL } from "../consts/tools";
import { instructionsSection } from "../lib/instructions-section";
import { prMeta } from "../lib/pr-meta";
import { buildSystemPrompt } from "../lib/review-system-prompt";
import { truncate } from "../lib/truncate";
import type { ReviewContext } from "./types";

/**
 * diff와 파일 원본이 나눠 쓸 예산.
 *
 * 지침 문서는 자르지 않으므로 먼저 빼둔다 — 다만 큰 지침 문서 하나가 코드를 통째로
 * 밀어내지 않도록 하한을 둔다. 원본을 싣지 않는 설정이면 diff가 예산을 다 쓴다.
 */
function promptBudgets(context: ReviewContext): {
	diff: number;
	sources: number;
} {
	const { maxPromptChars, includeSources } = context.config;
	const available = Math.max(
		Math.floor(maxPromptChars * 0.85) -
			(context.instructions?.content.length ?? 0),
		Math.floor(maxPromptChars * 0.3),
	);
	if (!includeSources || !context.sources?.length)
		return { diff: available, sources: 0 };
	return {
		diff: Math.floor(available * 0.45),
		sources: Math.floor(available * 0.55),
	};
}

function renderDiff(context: ReviewContext, budget: number): string {
	const text = context.diffFiles
		.map((file) => renderFileDiff(file, context.config.maxFileChars))
		.join("\n\n");
	return truncate(text, budget);
}

/**
 * 변경된 파일들의 현재 내용을 싣는다.
 *
 * diff는 바뀐 줄과 그 주변 몇 줄만 보여주므로, 함수 하나가 어떻게 생겼는지도 알 수 없다.
 * 그 상태로는 "이 값이 어디서 오는가" 같은 질문에 모델이 추측으로 답하게 된다.
 */
function sourcesSection(sources: FileSource[], budget: number): string {
	const rendered = sources
		.map((source) => renderFileSource(source))
		.join("\n\n");
	return [
		"",
		"## 변경된 파일의 현재 내용",
		"diff에 실린 것과 같은 파일들의 변경 후 전체 내용이다. 헝크 밖 맥락은 여기서 확인한다.",
		"어떤 줄이 이번에 새로 생겼는지 판단할 때도 diff의 `+` 표시보다 이쪽을 근거로 삼는다.",
		"",
		truncate(rendered, budget),
	].join("\n");
}

export function buildReviewMessages(context: ReviewContext): ChatMessage[] {
	const { config } = context;
	const budgets = promptBudgets(context);
	const sources = config.includeSources ? (context.sources ?? []) : [];

	const userPrompt = [
		"아래 Pull Request를 리뷰하라.",
		"",
		"## Pull Request",
		prMeta(context.pr),
		"",
		"## 변경 사항 (diff)",
		renderDiff(context, budgets.diff),
		sources.length ? sourcesSection(sources, budgets.sources) : "",
		context.instructions ? instructionsSection(context.instructions) : "",
		`\n${SUMMARY_TOOL} 을 반드시 호출하고, 지적할 것이 있으면 ${FINDING_TOOL} 도 함께 호출하라.`,
	].join("\n");

	return [
		{ role: "system", content: buildSystemPrompt(config) },
		{ role: "user", content: userPrompt },
	];
}
