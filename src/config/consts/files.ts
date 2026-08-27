/** 리포지토리 루트의 설정 파일 후보 (먼저 발견된 것 하나만 사용) */
export const CONFIG_FILES = [
	".reviewbot/config.yml",
	".reviewbot/config.yaml",
	".reviewbot.yml",
	".reviewbot.yaml",
];

/**
 * 리포지토리 루트의 코딩 지침 문서 후보 (먼저 발견된 것 하나만 사용).
 *
 * 사람과 다른 코딩 에이전트가 이미 쓰고 있는 문서를 그대로 리뷰 기준으로 삼는다 —
 * 리뷰 전용 지침을 따로 관리하면 둘이 어긋난다.
 */
export const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"];
