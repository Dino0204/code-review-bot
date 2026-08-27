import type { RawEvent, RepoRef } from "../model/types";

/** 이벤트 페이로드에서 리포지토리를 읽는다 — 웹훅에는 항상 실려 온다 */
export function repoRefFrom(event: RawEvent | undefined): RepoRef | undefined {
	const owner = event?.repository?.owner?.login;
	const repo = event?.repository?.name;
	return owner && repo ? { owner, repo } : undefined;
}
