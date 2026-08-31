import type { Severity } from "@/config/model/severity";

export const SEVERITY_LABEL: Record<Severity, string> = {
	critical: "🔴 critical",
	major: "🟠 major",
	minor: "🟡 minor",
	nit: "⚪ nit",
};
