import type { PullRequestInfo } from "@/github/client/model/types";
import { truncate } from "./truncate";

export function prMeta(pr: PullRequestInfo): string {
	return [
		`제목: ${pr.title}`,
		`작성자: ${pr.author}`,
		`브랜치: ${pr.headRef} → ${pr.baseRef}`,
		`변경량: ${pr.changedFiles}개 파일, +${pr.additions}/-${pr.deletions}`,
		pr.labels.length ? `라벨: ${pr.labels.join(", ")}` : "",
		"",
		"PR 본문:",
		truncate(pr.body || "(없음)", 3000),
	]
		.filter(Boolean)
		.join("\n");
}
