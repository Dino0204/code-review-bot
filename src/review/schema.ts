import { z } from 'zod'
import { SEVERITIES } from '../config'
import type { Severity } from '../config'

export const CATEGORIES = [
  'bug',
  'security',
  'performance',
  'maintainability',
  'test',
  'docs',
  'style',
  'other',
] as const
export type Category = (typeof CATEGORIES)[number]

/**
 * 모델 출력은 신뢰할 수 없으므로 최대한 관대하게 받아들이고(coerce/catch),
 * 정말 없으면 안 되는 필드(file/line/title/detail)만 엄격하게 검증한다.
 */
export const findingSchema = z.object({
  file: z.string().min(1),
  line: z.coerce.number().int().positive(),
  end_line: z.coerce.number().int().positive().nullish(),
  severity: z.enum(SEVERITIES).catch('minor'),
  category: z.string().catch('other'),
  title: z.string().min(1),
  detail: z.string().min(1),
  /** 그대로 적용 가능한 대체 코드 (GitHub suggestion 블록으로 렌더링된다) */
  suggestion: z.string().nullish(),
  confidence: z.coerce.number().min(0).max(1).catch(0.7),
})

export type RawFinding = z.infer<typeof findingSchema>

export const reviewResultSchema = z.object({
  summary: z.string().default(''),
  findings: z.array(findingSchema).default([]),
  verdict: z.enum(['approve', 'comment', 'request_changes']).catch('comment'),
})

export type ReviewResult = z.infer<typeof reviewResultSchema>

/** 위치 검증까지 마친, 실제로 게시할 지적 사항 */
export interface Finding {
  file: string
  line: number
  endLine?: number
  severity: Severity
  category: Category
  title: string
  detail: string
  suggestion?: string
  confidence: number
  /** 인라인 위치 검증에 실패해 요약에만 싣는 경우 */
  inlineDropped?: boolean
}

export function normalizeCategory(raw: string): Category {
  const value = raw.trim().toLowerCase()
  const match = CATEGORIES.find((category) => category === value)
  if (match) return match
  if (value.includes('security') || value.includes('vuln')) return 'security'
  if (value.includes('perf')) return 'performance'
  if (value.includes('test')) return 'test'
  if (value.includes('doc')) return 'docs'
  if (value.includes('style') || value.includes('format')) return 'style'
  if (value.includes('bug') || value.includes('correct')) return 'bug'
  if (value.includes('maintain') || value.includes('readab')) return 'maintainability'
  return 'other'
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: '🔴 critical',
  major: '🟠 major',
  minor: '🟡 minor',
  nit: '⚪ nit',
}

export const VERDICT_LABEL: Record<ReviewResult['verdict'], string> = {
  approve: '✅ 머지 가능',
  comment: '💬 확인 필요',
  request_changes: '⛔ 수정 요청',
}
