/** 상태를 저장할 PR 하나를 가리키는 값 */
export interface PrRef {
	owner: string;
	repo: string;
	pr: number;
}

/**
 * PR 하나에 대한 리뷰 상태 저장소.
 *
 * 프로세스가 죽어도 살아남아야 하는 것만 여기에 둔다 — 어디까지 봤는지(마커)가
 * 그것이다. core 는 이 포트를 부르지 않는다. 값을 받아 결과를 돌려줄 뿐이고,
 * 읽고 쓰는 것은 modules 쪽이 한다.
 */
export interface ReviewState {
	/** 파일 경로 → 마지막으로 리뷰한 내용의 해시 */
	markers(ref: PrRef): Promise<Map<string, string>>;
	/** 이번에 리뷰한 파일만 덮어쓴다 — 손대지 않은 파일의 마커는 그대로 남는다 */
	saveMarkers(ref: PrRef, hashes: Map<string, string>): Promise<void>;
	/** 이미 인라인으로 단 지적의 키 — 재시도가 같은 코멘트를 두 번 달지 않게 한다 */
	postedKeys(ref: PrRef): Promise<Set<string>>;
	addPostedKeys(ref: PrRef, keys: string[]): Promise<void>;
	/** 고쳐 쓸 요약 코멘트의 id. 아직 안 달았으면 undefined */
	summaryCommentId(ref: PrRef): Promise<number | undefined>;
	setSummaryCommentId(ref: PrRef, commentId: number): Promise<void>;
	/** PR 이 닫히거나 머지되면 이 PR 의 상태를 통째로 지운다 */
	clear(ref: PrRef): Promise<void>;
}
