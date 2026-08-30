import { LANGUAGE_LABEL } from "../consts/language-label";

export function languageName(code: string): string {
	return LANGUAGE_LABEL[code] ?? code;
}
