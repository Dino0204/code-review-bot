import type { BotConfig } from "@/config/model/bot-config";
import type {
	GitHubClient,
	PullRequestInfo,
} from "@/github/client/model/types";
import { parseUnifiedDiff } from "@/github/diff/lib/parse-unified-diff";
import type { DiffFile } from "@/github/diff/model/types";
import { log } from "@/logger";
import { buildFileSource } from "@/review/source/lib/build-file-source";
import type { FileSource } from "@/review/source/model/types";
import { filterFiles } from "../lib/filter-files";
import type { GatheredContext, RunnerDeps } from "./types";

/**
 * 리뷰 대상 파일들의 현재 내용을 읽는다.
 *
 * 파일 하나를 못 읽는다고 리뷰를 멈추지 않는다 — 그 파일만 diff로 보게 되고,
 * 몇 개를 실었는지는 로그로 남겨 나중에 지적의 근거를 되짚을 수 있게 한다.
 */
async function loadSources(
	github: GitHubClient,
	files: DiffFile[],
	ref: string,
	config: BotConfig,
): Promise<FileSource[]> {
	const loaded = await Promise.all(
		files.map(async (file) => {
			try {
				const content = await github.readFile(file.path, ref);
				if (content === undefined) return undefined;
				return buildFileSource(file, content, config.maxSourceChars);
			} catch (error) {
				log.warn(
					`파일 원본 읽기 실패(무시): ${file.path} — ${error instanceof Error ? error.message : String(error)}`,
				);
				return undefined;
			}
		}),
	);

	const sources = loaded.filter(
		(source): source is FileSource => source !== undefined,
	);
	const partial = sources.filter((source) => source.partial).length;
	log.info(
		`파일 원본 ${sources.length}/${files.length}개 로드` +
			(partial ? ` (${partial}개는 발췌)` : ""),
	);
	return sources;
}

/** PR diff를 받아 리뷰 대상 파일만 추린다 */
export async function gatherContext(
	deps: RunnerDeps,
	pr: PullRequestInfo,
): Promise<GatheredContext> {
	const { github, config, instructions } = deps;

	const rawDiff = await github.getPullRequestDiff(pr.number);
	const allFiles = parseUnifiedDiff(rawDiff);
	const { selected, skipped } = filterFiles(allFiles, config);
	log.info(
		`diff 파일 ${allFiles.length}개 중 ${selected.length}개 리뷰 대상 (${skipped}개 제외)`,
	);

	const sources = config.includeSources
		? await loadSources(github, selected, pr.headSha, config)
		: [];

	return {
		context: { config, pr, diffFiles: selected, sources, instructions },
		skippedFiles: skipped,
	};
}
