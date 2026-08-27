import { speakingLines } from "./speaking-lines";

/**
 * 앞에 `@` 를 붙였을 때 다른 계정으로 읽히지 않게 경계를 둔다 —
 * `@bot` 이 `@bot-staging` 이나 메일 주소 `a@bot` 에 걸리면 안 된다.
 */
function mentionPattern(name: string): RegExp {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(^|[^\\w/-])@${escaped}(?![\\w-])`, "i");
}

/**
 * 코멘트가 봇을 부르고 있는가 (`@봇이름`).
 *
 * 슬래시 명령과 달리 멘션은 문장 아무 데나 올 수 있다 —
 * "@bot 이 부분 문서 형식에 대한 논의가 필요합니다" 처럼.
 */
export function hasMention(body: string, mention: string): boolean {
	const name = mention.trim().replace(/^@/, "");
	if (!name) return false;
	const pattern = mentionPattern(name);
	return speakingLines(body).some((line) => pattern.test(line));
}
