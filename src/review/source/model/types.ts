/** 원본에서 잘라낸 연속 구간 하나 */
export interface SourceRegion {
	/** lines[0] 의 파일 내 줄 번호 (1부터) */
	startLine: number;
	lines: string[];
}

/** 프롬프트에 실을 파일 하나의 현재 내용 */
export interface FileSource {
	path: string;
	/** 원본 전체 줄 수 — 발췌가 얼마나 잘렸는지 모델이 가늠할 수 있게 한다 */
	totalLines: number;
	/** 전체를 싣지 못하고 일부만 실었는가 */
	partial: boolean;
	regions: SourceRegion[];
}
