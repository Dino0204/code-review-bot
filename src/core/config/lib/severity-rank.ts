import type { Severity } from "../model/severity";
import { SEVERITIES } from "../model/severity";

export function severityRank(severity: Severity): number {
	return SEVERITIES.indexOf(severity);
}

/** severity가 기준치 이상인가 (critical이 가장 높음) */
export function meetsSeverity(
	severity: Severity,
	threshold: Severity,
): boolean {
	return severityRank(severity) <= severityRank(threshold);
}
