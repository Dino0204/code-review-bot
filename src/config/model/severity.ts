export const SEVERITIES = ["critical", "major", "minor", "nit"] as const;
export type Severity = (typeof SEVERITIES)[number];
