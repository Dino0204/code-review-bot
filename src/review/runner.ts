import { minimatch } from 'minimatch'
import type { BotConfig } from '../config'
import { meetsSeverity } from '../config'
import type { LlmClient } from '../llm'
import type { GitHubClient, InlineComment, PullRequestInfo } from '../github/client'
import type { DiffFile } from '../github/diff'
import { parseUnifiedDiff, renderFileDiff, snapToCommentableLine } from '../github/diff'
import { buildReviewMessages } from './prompt'
import type { ReviewContext } from './prompt'
import { reviewResultSchema, normalizeCategory } from './schema'
import type { Finding, ReviewResult } from './schema'
import { renderFindingComment, renderPlainComment, renderReviewSummary } from './render'
import { log } from '../logger'

export interface RunnerDeps {
  github: GitHubClient
  llm: LlmClient
  config: BotConfig
  workspace: string
}

export interface GatherOptions {
  focus?: string
}

export interface GatheredContext {
  context: ReviewContext
  skippedFiles: number
}

/** PR diff를 받아 리뷰 대상 파일만 추린다 */
export async function gatherContext(
  deps: RunnerDeps,
  pr: PullRequestInfo,
  options: GatherOptions = {},
): Promise<GatheredContext> {
  const { github, config } = deps

  const rawDiff = await github.getPullRequestDiff(pr.number)
  const allFiles = parseUnifiedDiff(rawDiff)
  const { selected, skipped } = filterFiles(allFiles, config)
  log.info(`diff 파일 ${allFiles.length}개 중 ${selected.length}개 리뷰 대상 (${skipped}개 제외)`)

  return {
    context: { config, pr, diffFiles: selected, focus: options.focus ?? '' },
    skippedFiles: skipped,
  }
}

export function filterFiles(files: DiffFile[], config: BotConfig): { selected: DiffFile[]; skipped: number } {
  const matched = files.filter((file) => {
    if (file.isBinary) return false
    if (file.status === 'deleted') return false // 삭제된 파일에는 코멘트를 달 수 없다
    if (config.include.length && !config.include.some((pattern) => minimatch(file.path, pattern, { dot: true }))) return false
    if (config.exclude.some((pattern) => minimatch(file.path, pattern, { dot: true }))) return false
    return file.hunks.length > 0
  })

  // 변경량이 큰 파일부터 — 예산이 모자라면 사소한 파일이 잘려나가게 한다
  const sorted = [...matched].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
  const selected = sorted.slice(0, config.maxFiles)
  return { selected, skipped: files.length - selected.length }
}

/** diff가 프롬프트 예산을 넘으면 파일 단위로 쪼갠다. */
export function chunkFiles(files: DiffFile[], config: BotConfig): DiffFile[][] {
  const diffBudget = Math.floor(config.maxPromptChars * 0.5)
  const chunks: DiffFile[][] = []
  let current: DiffFile[] = []
  let size = 0

  for (const file of files) {
    const rendered = renderFileDiff(file, config.maxFileChars).length
    if (current.length > 0 && size + rendered > diffBudget) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(file)
    size += rendered
  }
  if (current.length) chunks.push(current)
  return chunks.length ? chunks : [[]]
}

export interface ReviewOutcome {
  posted: boolean
  findings: number
  inline: number
  verdict: ReviewResult['verdict']
}

export async function runReview(
  deps: RunnerDeps,
  pr: PullRequestInfo,
  options: GatherOptions = {},
): Promise<ReviewOutcome> {
  const { github, llm, config } = deps
  const { context, skippedFiles } = await gatherContext(deps, pr, options)

  if (context.diffFiles.length === 0) {
    await github.createIssueComment(
      pr.number,
      renderPlainComment('🤖 코드 리뷰', '리뷰할 변경 사항이 없다. (제외 패턴에 걸렸거나 바이너리/삭제만 포함된 PR)', {
        model: llm.model,
      }),
    )
    return { posted: true, findings: 0, inline: 0, verdict: 'approve' }
  }

  const chunks = chunkFiles(context.diffFiles, config)
  log.info(`리뷰 청크 ${chunks.length}개`)

  const results: ReviewResult[] = []
  for (const [index, chunk] of chunks.entries()) {
    if (chunks.length > 1) log.info(`청크 ${index + 1}/${chunks.length} 리뷰 중 (${chunk.length}개 파일)`)
    const chunkContext: ReviewContext = { ...context, diffFiles: chunk }
    const result = await llm.chatJson(buildReviewMessages(chunkContext), reviewResultSchema, {
      temperature: config.temperature,
      maxTokens: config.maxOutputTokens,
    })
    results.push(result)
  }

  const merged = mergeResults(results)
  const { inline, overflow } = prepareFindings(merged, context.diffFiles, config)

  // GitHub 멀티라인 코멘트는 `line`이 끝 줄, `start_line`이 시작 줄이다
  const comments: InlineComment[] = inline.map((finding) => {
    const hasRange = finding.endLine !== undefined && finding.endLine > finding.line
    return {
      path: finding.file,
      line: hasRange ? finding.endLine! : finding.line,
      startLine: hasRange ? finding.line : undefined,
      body: renderFindingComment(finding),
    }
  })

  const body = renderReviewSummary(merged, inline, overflow, {
    model: llm.model,
    reviewedFiles: context.diffFiles.length,
    skippedFiles,
    promptTokens: llm.totalUsage.prompt_tokens,
    completionTokens: llm.totalUsage.completion_tokens,
    chunks: chunks.length,
  }, config)

  const { posted, degraded } = await github.createReview(pr.number, pr.headSha, body, comments)
  if (degraded) {
    log.warn('인라인 코멘트가 등록되지 않아 요약만 게시했다')
  }

  return {
    posted: true,
    findings: inline.length + overflow.length,
    inline: posted,
    verdict: merged.verdict,
  }
}

function mergeResults(results: ReviewResult[]): ReviewResult {
  if (results.length === 1) return results[0]!

  const verdictRank = { request_changes: 0, comment: 1, approve: 2 } as const
  const verdict = results
    .map((result) => result.verdict)
    .sort((a, b) => verdictRank[a] - verdictRank[b])[0] as ReviewResult['verdict']

  return {
    summary: results
      .map((result) => result.summary.trim())
      .filter(Boolean)
      .join('\n\n'),
    findings: results.flatMap((result) => result.findings),
    verdict: verdict ?? 'comment',
  }
}

/**
 * 모델이 뱉은 지적을 실제 게시 가능한 형태로 정제한다.
 * - 파일 경로를 diff에 존재하는 경로로 해석
 * - 줄 번호를 diff 안의 유효한 위치로 스냅
 * - 심각도/확신도 임계값 적용, 중복 제거, 개수 제한
 */
export function prepareFindings(
  result: ReviewResult,
  files: DiffFile[],
  config: BotConfig,
): { inline: Finding[]; overflow: Finding[] } {
  const severityOrder = { critical: 0, major: 1, minor: 2, nit: 3 }
  const seen = new Set<string>()
  const candidates: Finding[] = []

  for (const raw of result.findings) {
    if (!meetsSeverity(raw.severity, config.minSeverity)) continue
    if (raw.confidence < config.minConfidence) continue

    const file = resolveFile(raw.file, files)
    if (!file) {
      log.debug(`diff에 없는 파일이라 버린다: ${raw.file}`)
      continue
    }

    const line = snapToCommentableLine(file, raw.line)
    const endLine = raw.end_line ? snapToCommentableLine(file, raw.end_line) : undefined

    const finding: Finding = {
      file: file.path,
      line: line ?? raw.line,
      endLine: endLine ?? undefined,
      severity: raw.severity,
      category: normalizeCategory(raw.category),
      title: raw.title.trim(),
      detail: raw.detail.trim(),
      suggestion: raw.suggestion?.trim() || undefined,
      confidence: raw.confidence,
      inlineDropped: line === undefined,
    }

    const key = dedupeKey(finding.file, finding.line, finding.title)
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push(finding)
  }

  candidates.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.confidence - a.confidence,
  )

  const inline: Finding[] = []
  const overflow: Finding[] = []
  for (const finding of candidates) {
    if (finding.inlineDropped || inline.length >= config.maxInlineComments) overflow.push(finding)
    else inline.push(finding)
  }

  return { inline, overflow }
}

/** 모델이 `a/src/x.ts`, `./src/x.ts`, `x.ts` 등으로 흘려 쓴 경로를 diff의 실제 경로에 맞춘다 */
export function resolveFile(raw: string, files: DiffFile[]): DiffFile | undefined {
  const cleaned = raw.trim().replace(/^\.\//, '').replace(/^[ab]\//, '')
  const exact = files.find((file) => file.path === cleaned)
  if (exact) return exact

  const suffix = files.filter((file) => file.path.endsWith(`/${cleaned}`))
  if (suffix.length === 1) return suffix[0]

  const base = cleaned.split('/').pop()
  if (!base) return undefined
  const byBasename = files.filter((file) => file.path.endsWith(`/${base}`) || file.path === base)
  return byBasename.length === 1 ? byBasename[0] : undefined
}

/** 같은 지적인지 판단하는 키. 제목의 앞부분만 써서 문구가 조금 달라져도 중복으로 잡는다. */
export function dedupeKey(path: string, line: number, title: string): string {
  const normalized = title
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 60)
  return `${path}:${line}:${normalized}`
}
