import type { BotConfig } from '../config'
import type { Finding, ReviewResult } from './schema'
import { SEVERITY_LABEL, VERDICT_LABEL } from './schema'

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
    `**${SEVERITY_LABEL[finding.severity]} · ${finding.category}** — ${finding.title}`,
    '',
    finding.detail.trim(),
  ]

  const suggestion = usableSuggestion(finding)
  if (suggestion) {
    parts.push('', '```suggestion', suggestion, '```')
  } else if (finding.suggestion?.trim()) {
    const raw = stripFence(finding.suggestion)
    if (looksLikeCode(raw)) {
      parts.push('', '**제안** (직접 적용해야 한다):', '```', raw.replace(/^\n+/, ''), '```')
    } else {
      parts.push('', `**제안:** ${raw.trim().replace(/\s*\n+\s*/g, ' ')}`)
    }
  }

  if (finding.confidence < 0.7) {
    parts.push('', `<sub>확신도 ${Math.round(finding.confidence * 100)}% — 오탐일 수 있다.</sub>`)
  }

  return parts.join('\n')
}

export function stripFence(code: string): string {
  const match = /^\s*```[\w-]*\n([\s\S]*?)\n?```\s*$/.exec(code)
  return (match?.[1] ?? code).replace(/\s+$/, '')
}

const KOREAN_SENTENCE_END = /(합니다|하세요|해야\s|입니다|세요|십시오|같습니다|필요합니다)/
const PROSE_LEAD = /^\s*(?:[-*]\s*)?[가-힣]/

export function looksLikeCode(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (KOREAN_SENTENCE_END.test(trimmed)) return false
  if (PROSE_LEAD.test(trimmed)) return false
  return trimmed.includes('\n') || /[{};=()]/.test(trimmed)
}

export function usableSuggestion(finding: Finding): string | undefined {
  const raw = finding.suggestion
  if (!raw?.trim()) return undefined

  if (finding.endLine !== undefined && finding.endLine !== finding.line) return undefined

  const code = stripFence(raw)
  if (!code.trim()) return undefined

  if (code.includes('`')) return undefined
  if (KOREAN_SENTENCE_END.test(code)) return undefined
  if (PROSE_LEAD.test(code)) return undefined

  return code
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
    `## 🤖 코드 리뷰 — ${VERDICT_LABEL[result.verdict]}`,
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

  parts.push('', '---', `<sub>${stats}</sub>`, `<sub>\`${config.triggerPrefix} help\` 로 사용법을 볼 수 있다.</sub>`)

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
