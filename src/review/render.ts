import { BOT_MARKER } from '../context/memory'
import type { BotConfig } from '../config'
import type { Finding, ReviewResult } from './schema'
import { SEVERITY_LABEL, VERDICT_LABEL } from './schema'

export interface ReviewMeta {
  model: string
  reviewedFiles: number
  skippedFiles: number
  runUrl?: string
  promptTokens?: number
  completionTokens?: number
  chunks: number
}

/** 인라인 리뷰 코멘트 본문 */
export function renderFindingComment(finding: Finding): string {
  const parts = [
    BOT_MARKER,
    `**${SEVERITY_LABEL[finding.severity]} · ${finding.category}** — ${finding.title}`,
    '',
    finding.detail.trim(),
  ]

  if (finding.suggestion?.trim()) {
    parts.push('', '```suggestion', stripFence(finding.suggestion).replace(/\n+$/, ''), '```')
  }

  if (finding.confidence < 0.7) {
    parts.push('', `<sub>확신도 ${Math.round(finding.confidence * 100)}% — 오탐일 수 있다.</sub>`)
  }

  return parts.join('\n')
}

/** 모델이 suggestion을 코드펜스로 감싸서 보내는 경우가 잦다 */
function stripFence(code: string): string {
  const trimmed = code.trim()
  const match = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(trimmed)
  return match?.[1] ?? code.replace(/\n+$/, '')
}

/** 리뷰 요약(리뷰 본문) */
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
    meta.runUrl ? `[실행 로그](${meta.runUrl})` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  parts.push('', '---', `<sub>${stats}</sub>`, `<sub>\`${config.triggerPrefix} help\` 로 사용법을 볼 수 있다.</sub>`)

  return parts.join('\n')
}

/**
 * 봇이 이전에 남긴 인라인 코멘트에서 지적 제목을 되뽑는다.
 * `**🟠 major · bug** — 제목` 형식이 아니면 첫 줄을 그대로 쓴다.
 */
export function extractFindingTitle(body: string): string {
  const withoutMarker = body.replace(BOT_MARKER, '').trim()
  const firstLine = withoutMarker.split('\n').find((line) => line.trim()) ?? ''
  const match = /\*\*.*?\*\*\s*—\s*(.+)$/.exec(firstLine.trim())
  return (match?.[1] ?? firstLine).trim()
}

export function renderPlainComment(title: string, body: string, meta?: { model: string; runUrl?: string }): string {
  const parts = [BOT_MARKER, `## ${title}`, '', body.trim()]
  if (meta) {
    const footer = [`모델 \`${meta.model}\``, meta.runUrl ? `[실행 로그](${meta.runUrl})` : ''].filter(Boolean).join(' · ')
    parts.push('', '---', `<sub>${footer}</sub>`)
  }
  return parts.join('\n')
}

export function renderError(message: string, runUrl?: string): string {
  return [
    BOT_MARKER,
    '## ⚠️ 코드 리뷰 실패',
    '',
    '```',
    message.slice(0, 1500),
    '```',
    runUrl ? `\n[실행 로그 보기](${runUrl})` : '',
  ].join('\n')
}

function countBySeverity(findings: Finding[]): Record<Finding['severity'], number> {
  const counts = { critical: 0, major: 0, minor: 0, nit: 0 }
  for (const finding of findings) counts[finding.severity]++
  return counts
}
