import { minimatch } from 'minimatch'
import type { BotConfig } from '../config'
import { meetsSeverity } from '../config'
import type { LlmClient, ToolCall } from '../llm'
import type { GitHubClient, InlineComment, PullRequestInfo } from '../github/client'
import type { DiffFile } from '../github/diff'
import { parseUnifiedDiff, renderFileDiff, snapToCommentableLine } from '../github/diff'
import { FINDING_TOOL, SUMMARY_TOOL, buildReviewMessages, reviewTools } from './prompt'
import type { RepoInstructions, ReviewContext } from './prompt'
import { findingSchema } from './schema'
import type { Finding, RawFinding, ReviewResult } from './schema'
import { renderFindingComment, renderPlainComment, renderReviewSummary } from './render'
import { log } from '../logger'

export interface RunnerDeps {
  github: GitHubClient
  llm: LlmClient
  config: BotConfig
  /** 리포지토리 지침 문서. 없는 리포지토리도 있으므로 선택 사항이다 */
  instructions?: RepoInstructions
}

interface GatheredContext {
  context: ReviewContext
  skippedFiles: number
}

/** PR diff를 받아 리뷰 대상 파일만 추린다 */
async function gatherContext(deps: RunnerDeps, pr: PullRequestInfo): Promise<GatheredContext> {
  const { github, config, instructions } = deps

  const rawDiff = await github.getPullRequestDiff(pr.number)
  const allFiles = parseUnifiedDiff(rawDiff)
  const { selected, skipped } = filterFiles(allFiles, config)
  log.info(`diff 파일 ${allFiles.length}개 중 ${selected.length}개 리뷰 대상 (${skipped}개 제외)`)

  return {
    context: { config, pr, diffFiles: selected, instructions },
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

/**
 * diff가 프롬프트 예산을 넘으면 파일 단위로 쪼갠다.
 *
 * 지침 문서는 청크마다 다시 실리므로 그 길이를 청크 예산에서 미리 뺀다.
 * 다만 파일 하나는 언제나 담을 수 있어야 하므로 maxFileChars를 하한으로 둔다.
 */
export function chunkFiles(files: DiffFile[], config: BotConfig, instructionChars = 0): DiffFile[][] {
  const diffBudget = Math.max(Math.floor(config.maxPromptChars * 0.5) - instructionChars, config.maxFileChars)
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
}

export async function runReview(deps: RunnerDeps, pr: PullRequestInfo): Promise<ReviewOutcome> {
  const { github, llm, config } = deps
  const { context, skippedFiles } = await gatherContext(deps, pr)

  if (context.diffFiles.length === 0) {
    await github.createIssueComment(
      pr.number,
      renderPlainComment('🤖 코드 리뷰', '리뷰할 변경 사항이 없다. (제외 패턴에 걸렸거나 바이너리/삭제만 포함된 PR)', {
        model: llm.model,
      }),
    )
    return { posted: true, findings: 0, inline: 0 }
  }

  const chunks = chunkFiles(context.diffFiles, config, context.instructions?.content.length ?? 0)
  log.info(`리뷰 청크 ${chunks.length}개`)

  const results: ReviewResult[] = []
  for (const [index, chunk] of chunks.entries()) {
    if (chunks.length > 1) log.info(`청크 ${index + 1}/${chunks.length} 리뷰 중 (${chunk.length}개 파일)`)
    const chunkContext: ReviewContext = { ...context, diffFiles: chunk }
    results.push(await requestReview(llm, chunkContext, config))
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
  }
}

/**
 * 모델에게 도구를 제시해 리뷰 결과를 받는다.
 *
 * 도구 주입은 그래머 강제가 아니라 프롬프트 기반이므로 모델이 도구를 아예 안 부를 수 있다.
 * 그 경우 한 번 더 시도하고, 그래도 못 받으면 모델이 쓴 본문을 요약으로 대신 실어
 * 인라인 코멘트 없이도 리뷰가 통째로 사라지지 않게 한다.
 */
async function requestReview(llm: LlmClient, context: ReviewContext, config: BotConfig): Promise<ReviewResult> {
  const messages = buildReviewMessages(context)
  const tools = reviewTools(config)
  const options = { temperature: config.temperature, maxTokens: config.maxOutputTokens }

  let lastText = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    // 재시도는 같은 프롬프트를 그대로 다시 보내는 대신 무엇이 잘못됐는지 알려준다.
    const attemptMessages =
      attempt === 1 ? messages : [...messages, { role: 'user' as const, content: retryNudge() }]

    const { toolCalls, text } = await llm.chatWithTools(attemptMessages, tools, options)
    if (toolCalls.length > 0) return collectToolCalls(toolCalls)

    lastText = text
    log.warn(`모델이 도구를 호출하지 않았다 (${attempt}/2)`)
  }

  return {
    summary: `_(모델이 도구를 호출하지 않아 본문을 그대로 싣는다 — 인라인 코멘트는 없다)_\n\n${lastText}`,
    findings: [],
  }
}

/** 도구를 부르지 않은 응답에 붙이는 교정 지시. 형식은 도구 블록에 이미 있으므로 되풀이하지 않는다. */
function retryNudge(): string {
  return [
    '방금 응답에는 도구 호출이 없었다. 본문만 쓴 응답은 전달되지 않고 버려진다.',
    `같은 리뷰를 ${SUMMARY_TOOL} 호출 한 번과, 지적마다 ${FINDING_TOOL} 호출로 다시 제출하라.`,
    '<tool_call> 블록 밖에는 아무것도 쓰지 마라.',
  ].join('\n')
}

/**
 * 도구 호출을 리뷰 결과로 모은다.
 *
 * 모델 출력은 신뢰하지 않는다 — 스키마에 맞지 않는 지적은 버리고 나머지는 살린다.
 * 하나가 어긋났다고 리뷰 전체를 잃는 것보다, 검증을 통과한 것만 게시하는 편이 낫다.
 */
function collectToolCalls(toolCalls: ToolCall[]): ReviewResult {
  const summaries: string[] = []
  const findings: RawFinding[] = []
  let malformed = 0
  let unknown = 0

  for (const call of toolCalls) {
    if (call.name === SUMMARY_TOOL) {
      const summary = call.arguments['summary']?.trim()
      if (summary) summaries.push(summary)
      continue
    }
    if (call.name !== FINDING_TOOL) {
      log.warn(`모델이 알 수 없는 도구를 호출했다: ${call.name}`)
      unknown++
      continue
    }

    const parsed = findingSchema.safeParse(call.arguments)
    if (parsed.success) {
      findings.push(parsed.data)
      continue
    }
    malformed++
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    log.warn(`지적 하나가 스키마와 맞지 않아 버렸다 — ${issues}`)
  }

  // 지적이 0건일 때 원인을 가릴 수 있어야 한다 —
  // 모델이 요약만 낸 것과, 낸 지적이 검증에서 떨어진 것은 서로 다른 문제다.
  log.info(
    `도구 호출 ${toolCalls.length}건 — 요약 ${summaries.length}, 지적 ${findings.length}` +
      (malformed ? `, 형식 오류 ${malformed}` : '') +
      (unknown ? `, 모르는 도구 ${unknown}` : ''),
  )

  return { summary: summaries.join('\n\n'), findings }
}

function mergeResults(results: ReviewResult[]): ReviewResult {
  if (results.length === 1) return results[0]!

  return {
    summary: results
      .map((result) => result.summary.trim())
      .filter(Boolean)
      .join('\n\n'),
    findings: results.flatMap((result) => result.findings),
  }
}

/**
 * 모델이 뱉은 지적을 실제 게시 가능한 형태로 정제한다.
 * - 파일 경로를 diff에 존재하는 경로로 해석
 * - 줄 번호를 diff 안의 유효한 위치로 스냅
 * - 심각도 임계값 적용, 중복 제거, 개수 제한
 */
export function prepareFindings(
  result: ReviewResult,
  files: DiffFile[],
  config: BotConfig,
): { inline: Finding[]; overflow: Finding[] } {
  const severityOrder = { critical: 0, major: 1, minor: 2, nit: 3 }
  const seen = new Set<string>()
  const candidates: Finding[] = []
  // 여기서 걸러진 지적은 인라인에도 요약에도 실리지 않는다 — 사라진 이유를 셈해 남긴다
  const dropped = { severity: 0, file: 0, duplicate: 0 }

  for (const raw of result.findings) {
    if (!meetsSeverity(raw.severity, config.minSeverity)) {
      dropped.severity++
      continue
    }

    const file = resolveFile(raw.file, files)
    if (!file) {
      log.debug(`diff에 없는 파일이라 버린다: ${raw.file}`)
      dropped.file++
      continue
    }

    // line === 0은 모델이 특정 줄을 짚지 못했다는 뜻(schema.ts 참고) — 스냅을 시도하지 않고 바로 요약행이다
    const hasLine = raw.line > 0
    const line = hasLine ? snapToCommentableLine(file, raw.line) : undefined
    const endLine = raw.end_line ? snapToCommentableLine(file, raw.end_line) : undefined

    const finding: Finding = {
      file: file.path,
      line: line ?? (hasLine ? raw.line : 1),
      endLine: endLine ?? undefined,
      severity: raw.severity,
      title: raw.title.trim(),
      detail: raw.detail.trim(),
      suggestion: raw.suggestion?.trim() || undefined,
      inlineDropped: line === undefined,
    }

    const key = dedupeKey(finding.file, finding.line, finding.title)
    if (seen.has(key)) {
      dropped.duplicate++
      continue
    }
    seen.add(key)
    candidates.push(finding)
  }

  candidates.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  const inline: Finding[] = []
  const overflow: Finding[] = []
  for (const finding of candidates) {
    if (finding.inlineDropped || inline.length >= config.maxInlineComments) overflow.push(finding)
    else inline.push(finding)
  }

  if (result.findings.length > 0) {
    const total = dropped.severity + dropped.file + dropped.duplicate
    log.info(
      `지적 ${result.findings.length}건 → 인라인 ${inline.length}, 요약 ${overflow.length}` +
        (total
          ? ` (제외 ${total} — 심각도 ${dropped.severity}, 경로 ${dropped.file}, 중복 ${dropped.duplicate})`
          : ''),
    )
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
