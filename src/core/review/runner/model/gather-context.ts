import { selectChangedFiles } from "@/core/batch/lib/select-changed-files";
import type { BotConfig } from "@/core/config/model/bot-config";
import { fileHash } from "@/core/diff/lib/hunk-hash";
import { parseUnifiedDiff } from "@/core/diff/lib/parse-unified-diff";
import type { DiffFile } from "@/core/diff/model/types";
import type { GitHubClient, PullRequestInfo } from "@/core/github/port";
import { log } from "@/core/ports/logger";
import { buildFileSource } from "@/core/review/source/lib/build-file-source";
import type { FileSource } from "@/core/review/source/model/types";
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

/** 마커 없이 전체를 볼 때도 리뷰를 마치면 마커를 남긴다 — 다음 푸시부터 증분이 된다 */
function markerless(files: DiffFile[]): Map<string, string> {
	return new Map(files.map((file) => [file.path, fileHash(file)]));
}

/** PR diff를 받아 리뷰 대상 파일만 추린다 */
export async function gatherContext(
	deps: RunnerDeps,
	pr: PullRequestInfo,
): Promise<GatheredContext> {
	const { github, config, instructions, markers } = deps;

	const rawDiff = await github.getPullRequestDiff(pr.number);
	const allFiles = parseUnifiedDiff(rawDiff);
	const { selected, skipped } = filterFiles(allFiles, config);
	log.info(
		`diff 파일 ${allFiles.length}개 중 ${selected.length}개 리뷰 대상 (${skipped}개 제외)`,
	);

	// 마커를 받았으면 달라진 파일만 본다. 원본을 읽는 것도 그 파일들에 대해서만 한다 —
	// 안 볼 파일까지 읽으면 API 쿼터만 쓴다.
	const { changed, unchanged, hashes } = markers
		? selectChangedFiles(selected, markers)
		: { changed: selected, unchanged: [], hashes: markerless(selected) };
	if (unchanged.length)
		log.info(
			`증분 리뷰: ${changed.length}개 파일만 다시 본다 (${unchanged.length}개는 지난 리뷰 이후 그대로)`,
		);

	const sources = config.includeSources
		? await loadSources(github, changed, pr.headSha, config)
		: [];

	return {
		context: { config, pr, diffFiles: changed, sources, instructions },
		skippedFiles: skipped,
		unchangedFiles: unchanged.length,
		hashes,
	};
}
