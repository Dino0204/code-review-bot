import type { BotConfig } from "@/config/model/bot-config";
import type {
	PullRequestInfo,
	ReviewThread,
} from "@/github/client/model/types";
import type { DiffFile } from "@/github/diff/model/types";
import type { FileSource } from "@/review/source/model/types";

/** 리포지토리가 코드 작성자를 위해 두고 있는 지침 문서 (AGENTS.md 등) */
export interface RepoInstructions {
	/** 읽어온 리포지토리 내 경로. 프롬프트에 출처로 표시한다 */
	path: string;
	content: string;
}

export interface ReviewContext {
	config: BotConfig;
	pr: PullRequestInfo;
	diffFiles: DiffFile[];
	/** 변경된 파일들의 현재 내용. 읽지 못했거나 설정으로 껐으면 비어 있다 */
	sources?: FileSource[];
	instructions?: RepoInstructions;
}

/** 쓰레드가 가리키는 줄 주변의 현재 파일 내용 */
export interface FileExcerpt {
	/** lines[0] 의 파일 내 줄 번호 */
	startLine: number;
	lines: string[];
}

export interface ThreadContext {
	config: BotConfig;
	pr: PullRequestInfo;
	thread: ReviewThread;
	/** 파일을 읽지 못했거나 위치를 특정할 수 없으면 없다 */
	excerpt?: FileExcerpt;
	instructions?: RepoInstructions;
}
