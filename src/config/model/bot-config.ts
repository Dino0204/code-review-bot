import type { Severity } from "./severity";

export interface BotConfig {
	/** 모델 ID */
	model: string;
	/** OpenAI 호환 API base URL (버전 경로까지 포함) */
	baseUrl: string;
	/** 리뷰 코멘트 언어 */
	language: string;
	temperature: number;
	maxOutputTokens: number;

	/** 프롬프트 1회 호출에 실어보낼 최대 문자 수 (대략 4자 ≈ 1토큰) */
	maxPromptChars: number;
	/** 리뷰 대상 최대 파일 수 */
	maxFiles: number;
	/** 파일 하나를 컨텍스트에 넣을 때의 최대 문자 수 */
	maxFileChars: number;

	/** diff와 함께 변경된 파일의 현재 내용도 싣는다 */
	includeSources: boolean;
	/** 파일 하나의 현재 내용에 쓸 최대 문자 수 */
	maxSourceChars: number;
	/** 모델이 read_file로 더 읽어갈 수 있는 파일 수 (0이면 도구를 주지 않는다) */
	maxExtraReads: number;

	/** 리뷰에서 제외할 glob */
	exclude: string[];
	/** 지정 시 이 glob에 매칭되는 파일만 리뷰 */
	include: string[];

	/** PR open/reopen/ready_for_review 시 자동 리뷰 — 이후 푸시(synchronize)는 재리뷰하지 않는다 */
	autoReview: boolean;
	/** 이 심각도 미만은 코멘트하지 않음 */
	minSeverity: Severity;
	/** 인라인 코멘트 최대 개수 */
	maxInlineComments: number;

	/** 코멘트 트리거 접두사 */
	triggerPrefix: string;

	/** 인라인 리뷰 쓰레드에서 봇을 멘션하면 답글을 단다 */
	threadReply: boolean;
}
