import type { BotConfig } from '../config'
import type { Finding, ReviewResult } from './schema'
import { SEVERITY_LABEL } from './schema'

export const BOT_MARKER = '<!-- glm-code-review-bot -->'

export interface ReviewMeta {
  model: string
  reviewedFiles: number
  skippedFiles: number
  promptTokens?: number
  completionTokens?: number
  chunks: number
}

export function renderFindingComment(finding: Finding): string {
  const parts = [
    BOT_MARKER,
    `**${SEVERITY_LABEL[finding.severity]}** — ${finding.title}`,
    '',
    finding.detail.trim(),
  ]

  parts.push(...suggestionBlock(finding.suggestion))

  return parts.join('\n')
}

/** GitHub의 "이 코드로 교체" 블록. 적용할 코드가 없으면 아무것도 붙이지 않는다 */
function suggestionBlock(suggestion: string | undefined): string[] {
  const code = suggestion ? stripFence(suggestion).replace(/^\n+/, '') : ''
  if (!code.trim()) return []

  // 코드 안의 백틱보다 긴 펜스를 써야 블록이 중간에 끊기지 않는다
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(code) + 1))
  return ['', `${fence}suggestion`, code, fence]
}

/**
 * 코멘트 본문 상한. GitHub은 65,536자에서 거절한다 —
 * 도구 호출을 받지 못해 모델 본문을 그대로 싣는 경우를 대비해 여유를 두고 자른다.
 */
const MAX_REPLY_CHARS = 30_000

/**
 * 인라인 쓰레드에 다는 답글.
 *
 * 요약 코멘트와 달리 제목을 붙이지 않는다 — 쓰레드 안에서는 대화의 한 마디로 읽혀야 한다.
 */
export function renderThreadReply(
  reply: string,
  suggestion: string | undefined,
  meta: { model: string },
): string {
  const body = reply.trim()
  return [
    BOT_MARKER,
    body.length > MAX_REPLY_CHARS ? `${body.slice(0, MAX_REPLY_CHARS)}\n\n_(답변이 너무 길어 잘렸다)_` : body,
    ...suggestionBlock(suggestion),
    '',
    `<sub>모델 \`${meta.model}\`</sub>`,
  ].join('\n')
}

export function stripFence(code: string): string {
  const match = /^\s*```[\w-]*\n([\s\S]*?)\n?```\s*$/.exec(code)
  return (match?.[1] ?? code).replace(/\s+$/, '')
}

function longestBacktickRun(text: string): number {
  let longest = 0
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  return longest
}

export function renderReviewSummary(
  result: ReviewResult,
  inline: Finding[],
  overflow: Finding[],
  meta: ReviewMeta,
  config: BotConfig,
): string {
  const counts = countBySeverity([...inline, ...overflow])
  const badge = [
    counts.critical ? `🔴 ${counts.critical}` : '',
    counts.major ? `🟠 ${counts.major}` : '',
    counts.minor ? `🟡 ${counts.minor}` : '',
    counts.nit ? `⚪ ${counts.nit}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const parts = [
    BOT_MARKER,
    '## 🤖 코드 리뷰',
    '',
    result.summary.trim() || '_요약을 생성하지 못했다._',
    '',
    badge ? `**지적 사항:** ${badge}` : '**지적 사항 없음** — 변경분에서 문제를 찾지 못했다.',
  ]

  if (overflow.length) {
    parts.push(
      '',
      '<details><summary>인라인으로 달지 못한 지적 ' + overflow.length + '건 (diff 범위 밖이거나 개수 제한 초과)</summary>',
      '',
      ...overflow.map(
        (finding) =>
          `- **${SEVERITY_LABEL[finding.severity]}** \`${finding.file}:${finding.line}\` — ${finding.title}\n  ${finding.detail.replace(/\n/g, '\n  ')}`,
      ),
      '',
      '</details>',
    )
  }

  const stats = [
    `모델 \`${meta.model}\``,
    `파일 ${meta.reviewedFiles}개 리뷰${meta.skippedFiles ? ` (${meta.skippedFiles}개 제외)` : ''}`,
    meta.chunks > 1 ? `${meta.chunks}개 청크로 분할` : '',
    meta.promptTokens !== undefined ? `토큰 ${meta.promptTokens.toLocaleString()} in / ${(meta.completionTokens ?? 0).toLocaleString()} out` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  parts.push('', '---', `<sub>${stats}</sub>`)

  return parts.join('\n')
}

export function renderPlainComment(title: string, body: string, meta?: { model: string }): string {
  const parts = [BOT_MARKER, `## ${title}`, '', body.trim()]
  if (meta) {
    parts.push('', '---', `<sub>모델 \`${meta.model}\`</sub>`)
  }
  return parts.join('\n')
}

export function renderError(message: string, title = '코드 리뷰 실패'): string {
  return [BOT_MARKER, `## ⚠️ ${title}`, '', '```', message.slice(0, 1500), '```'].join('\n')
}

function countBySeverity(findings: Finding[]): Record<Finding['severity'], number> {
  const counts = { critical: 0, major: 0, minor: 0, nit: 0 }
  for (const finding of findings) counts[finding.severity]++
  return counts
}
