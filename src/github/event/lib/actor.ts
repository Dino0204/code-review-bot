import type { AuthorAssociation } from "../model/types";

/** 이벤트 페이로드만으로 판단 가능한 신뢰 관계 — API 호출 없이 통과시킨다 */
export function isTrustedAssociation(association: AuthorAssociation): boolean {
	return (
		association === "OWNER" ||
		association === "MEMBER" ||
		association === "COLLABORATOR"
	);
}

/** 봇 자신이 남긴 코멘트에 반응해 무한 루프에 빠지지 않도록 */
export function isBotActor(login: string): boolean {
	return login.endsWith("[bot]") || login === "github-actions";
}
