import type { GitHubClient, ReviewThread } from "@/github/client/model/types";
import { log } from "@/logger";
import type { FileExcerpt } from "@/review/prompt/model/types";
import { EXCERPT_RADIUS } from "../consts/radius";

/**
 * 쓰레드가 가리키는 줄 주변의 현재 파일 내용을 읽는다.
 *
 * diff 조각만으로는 몇 줄밖에 보이지 않아서, 함수 하나가 어떻게 생겼는지도 알 수 없다.
 * 파일을 읽지 못하면(삭제됐거나 너무 큰 경우) 그냥 없이 간다 — 답변을 막을 이유는 아니다.
 */
export async function loadExcerpt(
	github: GitHubClient,
	thread: ReviewThread,
	ref: string,
): Promise<FileExcerpt | undefined> {
	if (!thread.line) return undefined;

	let raw: string | undefined;
	try {
		raw = await github.readFile(thread.path, ref);
	} catch (error) {
		log.warn(
			`파일 발췌 실패(무시): ${thread.path} — ${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
	if (raw === undefined) return undefined;

	const lines = raw.split("\n");
	const startLine = Math.max(1, thread.line - EXCERPT_RADIUS);
	const endLine = Math.min(lines.length, thread.line + EXCERPT_RADIUS);
	if (startLine > lines.length) return undefined;

	return { startLine, lines: lines.slice(startLine - 1, endLine) };
}
