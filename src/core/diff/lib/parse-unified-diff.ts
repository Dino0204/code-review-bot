import type { DiffFile, DiffHunk } from "../model/types";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** `a/src/foo.ts` → `src/foo.ts`, `"a/한 글.ts"` → `한 글.ts` */
function stripPrefix(raw: string): string {
	let path = raw.trim();
	if (path.startsWith('"') && path.endsWith('"')) {
		try {
			path = JSON.parse(path) as string;
		} catch {
			path = path.slice(1, -1);
		}
	}
	if (path === "/dev/null") return "";
	if (path.startsWith("a/") || path.startsWith("b/")) return path.slice(2);
	return path;
}

/** git이 만든 unified diff를 파일/헝크 구조로 파싱한다. */
export function parseUnifiedDiff(raw: string): DiffFile[] {
	const files: DiffFile[] = [];
	const lines = raw.split("\n");

	let current: DiffFile | undefined;
	let hunk: DiffHunk | undefined;
	let oldCursor = 0;
	let newCursor = 0;
	// 헤더가 선언한 줄 수와 대조하려고 실제로 센다
	let oldSeen = 0;
	let newSeen = 0;

	const closeHunk = (): void => {
		if (!hunk) return;
		hunk.complete = oldSeen === hunk.oldLines && newSeen === hunk.newLines;
	};

	const flushFile = (): void => {
		closeHunk();
		if (current) files.push(current);
		current = undefined;
		hunk = undefined;
	};

	for (const line of lines) {
		if (line.startsWith("diff --git ")) {
			flushFile();
			// `diff --git a/x b/x` — 경로에 공백이 있으면 부정확할 수 있어 ---/+++ 줄에서 다시 덮어쓴다.
			const rest = line.slice("diff --git ".length);
			const half = Math.floor(rest.length / 2);
			const guess = stripPrefix(rest.slice(half + 1) || rest);
			current = {
				path: guess,
				status: "modified",
				hunks: [],
				additions: 0,
				deletions: 0,
				isBinary: false,
			};
			continue;
		}
		if (!current) continue;

		if (line.startsWith("new file mode")) {
			current.status = "added";
			continue;
		}
		if (line.startsWith("deleted file mode")) {
			current.status = "deleted";
			continue;
		}
		if (line.startsWith("rename from ")) {
			current.previousPath = stripPrefix(line.slice("rename from ".length));
			current.status = "renamed";
			continue;
		}
		if (line.startsWith("rename to ")) {
			current.path = stripPrefix(line.slice("rename to ".length));
			current.status = "renamed";
			continue;
		}
		if (
			line.startsWith("Binary files ") ||
			line.startsWith("GIT binary patch")
		) {
			current.isBinary = true;
			continue;
		}
		if (line.startsWith("--- ")) {
			const previous = stripPrefix(line.slice(4));
			if (previous) current.previousPath ??= previous;
			else current.status = "added";
			continue;
		}
		if (line.startsWith("+++ ")) {
			const path = stripPrefix(line.slice(4));
			if (path) current.path = path;
			else current.status = "deleted";
			continue;
		}
		if (
			line.startsWith("index ") ||
			line.startsWith("similarity index ") ||
			line.startsWith("old mode ") ||
			line.startsWith("new mode ")
		) {
			continue;
		}

		const header = HUNK_HEADER.exec(line);
		if (header) {
			closeHunk();
			hunk = {
				oldStart: Number(header[1]),
				oldLines: header[2] === undefined ? 1 : Number(header[2]),
				newStart: Number(header[3]),
				newLines: header[4] === undefined ? 1 : Number(header[4]),
				section: header[5] ?? "",
				lines: [],
				// 이 헝크의 마지막 줄을 지날 때 확정한다
				complete: false,
			};
			current.hunks.push(hunk);
			oldCursor = hunk.oldStart;
			newCursor = hunk.newStart;
			oldSeen = 0;
			newSeen = 0;
			continue;
		}
		if (!hunk) continue;

		if (line.startsWith("\\")) continue; // "\ No newline at end of file"

		const marker = line[0];
		const content = line.slice(1);
		if (marker === "+") {
			hunk.lines.push({ type: "add", content, newLine: newCursor });
			current.additions++;
			newCursor++;
			newSeen++;
		} else if (marker === "-") {
			hunk.lines.push({ type: "del", content, oldLine: oldCursor });
			current.deletions++;
			oldCursor++;
			oldSeen++;
		} else if (marker === " " || line === "") {
			hunk.lines.push({
				type: "ctx",
				content,
				oldLine: oldCursor,
				newLine: newCursor,
			});
			oldCursor++;
			newCursor++;
			oldSeen++;
			newSeen++;
		}
		// 그 밖의 줄(예: 예상치 못한 메타데이터)은 무시
	}

	flushFile();
	return files;
}
