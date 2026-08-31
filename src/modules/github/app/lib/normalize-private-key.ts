export function normalizePrivateKey(raw: string): string {
	const trimmed = raw.trim();
	return trimmed.includes("\\n") ? trimmed.replace(/\\n/g, "\n") : trimmed;
}
