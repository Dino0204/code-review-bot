export type DiffLineType = 'add' | 'del' | 'ctx'

export interface DiffLine {
  type: DiffLineType
  content: string
  /** 변경 전 파일에서의 줄 번호 (추가된 줄이면 undefined) */
  oldLine?: number
  /** 변경 후 파일에서의 줄 번호 (삭제된 줄이면 undefined) */
  newLine?: number
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** @@ 뒤에 붙는 컨텍스트 문자열 (보통 함수 시그니처) */
  section: string
  lines: DiffLine[]
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface DiffFile {
  path: string
  previousPath?: string
  status: FileStatus
  hunks: DiffHunk[]
  additions: number
  deletions: number
  isBinary: boolean
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

/** `a/src/foo.ts` → `src/foo.ts`, `"a/한 글.ts"` → `한 글.ts` */
function stripPrefix(raw: string): string {
  let path = raw.trim()
  if (path.startsWith('"') && path.endsWith('"')) {
    try {
      path = JSON.parse(path) as string
    } catch {
      path = path.slice(1, -1)
    }
  }
  if (path === '/dev/null') return ''
  if (path.startsWith('a/') || path.startsWith('b/')) return path.slice(2)
  return path
}

/** git이 만든 unified diff를 파일/헝크 구조로 파싱한다. */
export function parseUnifiedDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = []
  const lines = raw.split('\n')

  let current: DiffFile | undefined
  let hunk: DiffHunk | undefined
  let oldCursor = 0
  let newCursor = 0

  const flushFile = (): void => {
    if (current) files.push(current)
    current = undefined
    hunk = undefined
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flushFile()
      // `diff --git a/x b/x` — 경로에 공백이 있으면 부정확할 수 있어 ---/+++ 줄에서 다시 덮어쓴다.
      const rest = line.slice('diff --git '.length)
      const half = Math.floor(rest.length / 2)
      const guess = stripPrefix(rest.slice(half + 1) || rest)
      current = { path: guess, status: 'modified', hunks: [], additions: 0, deletions: 0, isBinary: false }
      continue
    }
    if (!current) continue

    if (line.startsWith('new file mode')) {
      current.status = 'added'
      continue
    }
    if (line.startsWith('deleted file mode')) {
      current.status = 'deleted'
      continue
    }
    if (line.startsWith('rename from ')) {
      current.previousPath = stripPrefix(line.slice('rename from '.length))
      current.status = 'renamed'
      continue
    }
    if (line.startsWith('rename to ')) {
      current.path = stripPrefix(line.slice('rename to '.length))
      current.status = 'renamed'
      continue
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      current.isBinary = true
      continue
    }
    if (line.startsWith('--- ')) {
      const previous = stripPrefix(line.slice(4))
      if (previous) current.previousPath ??= previous
      else current.status = 'added'
      continue
    }
    if (line.startsWith('+++ ')) {
      const path = stripPrefix(line.slice(4))
      if (path) current.path = path
      else current.status = 'deleted'
      continue
    }
    if (line.startsWith('index ') || line.startsWith('similarity index ') || line.startsWith('old mode ') || line.startsWith('new mode ')) {
      continue
    }

    const header = HUNK_HEADER.exec(line)
    if (header) {
      hunk = {
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        section: header[5] ?? '',
        lines: [],
      }
      current.hunks.push(hunk)
      oldCursor = hunk.oldStart
      newCursor = hunk.newStart
      continue
    }
    if (!hunk) continue

    if (line.startsWith('\\')) continue // "\ No newline at end of file"

    const marker = line[0]
    const content = line.slice(1)
    if (marker === '+') {
      hunk.lines.push({ type: 'add', content, newLine: newCursor })
      current.additions++
      newCursor++
    } else if (marker === '-') {
      hunk.lines.push({ type: 'del', content, oldLine: oldCursor })
      current.deletions++
      oldCursor++
    } else if (marker === ' ' || line === '') {
      hunk.lines.push({ type: 'ctx', content, oldLine: oldCursor, newLine: newCursor })
      oldCursor++
      newCursor++
    }
    // 그 밖의 줄(예: 예상치 못한 메타데이터)은 무시
  }

  flushFile()
  return files
}

/** GitHub 리뷰 코멘트를 달 수 있는(=diff에 포함된) 변경 후 파일의 줄 번호 집합 */
export function commentableLines(file: DiffFile): Set<number> {
  const lines = new Set<number>()
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.newLine !== undefined) lines.add(line.newLine)
    }
  }
  return lines
}

/** 실제로 추가/수정된 줄. 모델이 엉뚱한 컨텍스트 줄을 지목했을 때 스냅 기준이 된다. */
export function changedLines(file: DiffFile): Set<number> {
  const lines = new Set<number>()
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add' && line.newLine !== undefined) lines.add(line.newLine)
    }
  }
  return lines
}

/**
 * 모델이 지목한 줄이 diff 밖이면 가까운 유효 줄로 당겨온다.
 * window를 넘어가면 undefined — 인라인 대신 요약에만 싣는다.
 */
export function snapToCommentableLine(file: DiffFile, line: number, window = 5): number | undefined {
  const valid = commentableLines(file)
  if (valid.has(line)) return line
  for (let delta = 1; delta <= window; delta++) {
    if (valid.has(line - delta)) return line - delta
    if (valid.has(line + delta)) return line + delta
  }
  return undefined
}

/**
 * 모델이 줄 번호를 정확히 인용할 수 있도록 좌측에 변경 후 줄 번호를 붙여 렌더링한다.
 * 삭제된 줄은 번호 자리를 비우고 `-`로 표시한다.
 */
export function renderFileDiff(file: DiffFile, maxChars = 24_000): string {
  const header = `### ${file.path}${file.previousPath && file.previousPath !== file.path ? ` (이전 경로: ${file.previousPath})` : ''} — ${file.status}, +${file.additions}/-${file.deletions}`
  if (file.isBinary) return `${header}\n(바이너리 파일 — 내용 생략)`

  const body: string[] = []
  for (const hunk of file.hunks) {
    body.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.section}`.trimEnd())
    for (const line of hunk.lines) {
      const number = line.newLine === undefined ? '    ' : String(line.newLine).padStart(4, ' ')
      const marker = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '
      body.push(`${number} ${marker} ${line.content}`)
    }
  }

  const rendered = `${header}\n${body.join('\n')}`
  if (rendered.length <= maxChars) return rendered
  return `${rendered.slice(0, maxChars)}\n… (diff가 너무 길어 이후 생략)`
}

export function totalChangedLines(files: DiffFile[]): number {
  return files.reduce((sum, file) => sum + file.additions + file.deletions, 0)
}
