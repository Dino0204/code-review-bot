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

  const code = finding.suggestion ? stripFence(finding.suggestion).replace(/^\n+/, '') : ''
  if (code.trim()) {
    // 코드 안의 백틱보다 긴 펜스를 써야 블록이 중간에 끊기지 않는다
    const fence = '`'.repeat(Math.max(3, longestBacktickRun(code) + 1))
    parts.push('', `${fence}suggestion`, code, fence)
  }

  return parts.join('\n')
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

export function renderError(message: string): string {
  return [BOT_MARKER, '## ⚠️ 코드 리뷰 실패', '', '```', message.slice(0, 1500), '```'].join('\n')
}

function countBySeverity(findings: Finding[]): Record<Finding['severity'], number> {
  const counts = { critical: 0, major: 0, minor: 0, nit: 0 }
  for (const finding of findings) counts[finding.severity]++
  return counts
}
