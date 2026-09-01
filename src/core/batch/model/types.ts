export interface BatchBudget {
	/** 배치 하나에 실어보낼 diff·원본의 최대 문자 수. provider 예산에서 온다 */
	maxChars: number;
	/** 파일 하나를 렌더할 때의 상한 */
	maxFileChars: number;
	/** 배치마다 다시 실리는 지침 문서의 길이 — 예산에서 미리 뺀다 */
	instructionChars: number;
	/** 함께 싣는 파일 원본의 길이. 원본을 안 실으면 비운다 */
	sourceSizes?: Map<string, number>;
}
