import type { DiffFile } from '../github/diff'

/** 원본에서 잘라낸 연속 구간 하나 */
export interface SourceRegion {
  /** lines[0] 의 파일 내 줄 번호 (1부터) */
  startLine: number
  lines: string[]
}

/** 프롬프트에 실을 파일 하나의 현재 내용 */
export interface FileSource {
  path: string
  /** 원본 전체 줄 수 — 발췌가 얼마나 잘렸는지 모델이 가늠할 수 있게 한다 */
  totalLines: number
  /** 전체를 싣지 못하고 일부만 실었는가 */
  partial: boolean
  regions: SourceRegion[]
}

/** 변경 구간 앞뒤로 함께 실을 줄 수. 함수 하나가 통째로 들어올 만큼은 되어야 한다 */
export const SOURCE_RADIUS = 40

interface Range {
  start: number
  end: number
}

/**
 * diff의 각 헝크가 가리키는 범위를 앞뒤로 넓힌 뒤, 겹치거나 맞닿는 것끼리 합친다.
 *
 * 헝크 경계에서 끊긴 조각을 여러 개 주면 모델이 같은 함수를 여러 번 읽은 것으로 착각한다.
 */
function mergedRanges(file: DiffFile, totalLines: number, radius: number): Range[] {
  const ranges: Range[] = file.hunks.map((hunk) => ({
    start: Math.max(1, hunk.newStart - radius),
    end: Math.min(totalLines, hunk.newStart + Math.max(hunk.newLines, 1) - 1 + radius),
  }))

  ranges.sort((a, b) => a.start - b.start)

  const merged: Range[] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    // 사이가 한 줄뿐이면 붙여버린다 — 구분선을 넣는 것보다 그냥 잇는 편이 읽기 쉽다
    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end)
      continue
    }
    merged.push({ ...range })
  }
  return merged
}

/**
 * 파일의 현재 내용에서 프롬프트에 실을 부분을 고른다.
 *
 * 예산 안에 들면 파일 전체를 싣는다 — 리뷰어가 diff 밖을 확인하려면 그게 가장 확실하다.
 * 넘치면 변경 구간 주변만 남긴다. 앞쪽 구간부터 채우고, 예산이 떨어지면 거기서 멈춘다.
 */
export function buildFileSource(
  file: DiffFile,
  content: string,
  maxChars: number,
  radius = SOURCE_RADIUS,
): FileSource {
  const lines = content.split('\n')
  const totalLines = lines.length

  if (content.length <= maxChars) {
    return { path: file.path, totalLines, partial: false, regions: [{ startLine: 1, lines }] }
  }

  const regions: SourceRegion[] = []
  let used = 0
  let partial = true

  for (const range of mergedRanges(file, totalLines, radius)) {
    const slice = lines.slice(range.start - 1, range.end)
    const size = slice.reduce((sum, line) => sum + line.length + 1, 0)
    if (used + size > maxChars) break
    regions.push({ startLine: range.start, lines: slice })
    used += size
  }

  // 헝크 주변조차 예산을 넘으면 첫 구간을 잘라서라도 싣는다 — 빈손보다는 낫다
  if (regions.length === 0) {
    const first = mergedRanges(file, totalLines, radius)[0]
    if (first) {
      const slice = lines.slice(first.start - 1, first.end)
      const kept: string[] = []
      let size = 0
      for (const line of slice) {
        if (size + line.length + 1 > maxChars) break
        kept.push(line)
        size += line.length + 1
      }
      if (kept.length) regions.push({ startLine: first.start, lines: kept })
    }
  }

  if (regions.length === 1 && regions[0]!.startLine === 1 && regions[0]!.lines.length === totalLines) {
    partial = false
  }

  return { path: file.path, totalLines, partial, regions }
}

/** `줄번호 | 코드` — 모델이 diff의 줄 번호와 대조할 수 있게 맞춘다 */
function renderRegion(region: SourceRegion): string {
  const width = String(region.startLine + region.lines.length - 1).length
  return region.lines
    .map((line, index) => `${String(region.startLine + index).padStart(width, ' ')} | ${line}`)
    .join('\n')
}

export function renderFileSource(source: FileSource): string {
  const scope = source.partial
    ? `전체 ${source.totalLines}줄 중 변경 구간 주변만 발췌`
    : `전체 ${source.totalLines}줄`
  const header = `### ${source.path} (${scope})`

  if (source.regions.length === 0) return `${header}\n(내용을 읽지 못했다)`

  const body = source.regions
    .map((region) => renderRegion(region))
    .join('\n\n… (중략) …\n\n')

  return `${header}\n\`\`\`\n${body}\n\`\`\``
}

/** 이 파일 원본이 프롬프트에서 차지할 길이 — 청크 예산 계산에 쓴다 */
export function sourceLength(source: FileSource): number {
  return renderFileSource(source).length
}

/**
 * diff에 없는 파일을 통째로 싣는다. `read_file` 로 모델이 따로 요청한 파일용이다.
 *
 * 헝크가 없어 어디를 남길지 고를 수 없으므로 앞에서부터 예산만큼 자른다 —
 * 대부분의 파일은 import와 주요 선언이 위쪽에 있어 앞부분이 맥락을 더 많이 담는다.
 */
export function renderPlainSource(path: string, content: string, maxChars: number): string {
  const lines = content.split('\n')
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    if (used + line.length + 1 > maxChars) break
    kept.push(line)
    used += line.length + 1
  }

  const scope =
    kept.length === lines.length ? `전체 ${lines.length}줄` : `전체 ${lines.length}줄 중 앞 ${kept.length}줄`
  const width = String(kept.length).length
  const body = kept.map((line, index) => `${String(index + 1).padStart(width, ' ')} | ${line}`).join('\n')

  return `### ${path} (${scope})\n\`\`\`\n${body}\n\`\`\``
}
