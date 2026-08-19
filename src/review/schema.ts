import { z } from 'zod'
import { SEVERITIES } from '../config'
import type { Severity } from '../config'

/**
 * 모델 출력은 신뢰할 수 없으므로 최대한 관대하게 받아들이고(coerce/catch),
 * 정말 없으면 안 되는 필드(file/title/detail)만 엄격하게 검증한다.
 * line은 diff에 없는 파일(예: package.json 미변경)에 대한 지적처럼 모델이
 * 특정 줄을 짚지 못하는 경우가 있어, 실패 시 0("줄 없음")으로 떨어뜨린다 —
 * 하나의 findings 항목이 배열 전체 파싱을 무너뜨리면 안 된다.
 */
export const findingSchema = z.object({
  file: z.string().min(1),
  line: z.coerce.number().int().positive().catch(0),
  end_line: z.coerce.number().int().positive().nullish().catch(undefined),
  severity: z.enum(SEVERITIES).catch('minor'),
  title: z.string().min(1),
  detail: z.string().min(1),
  /** 그대로 적용 가능한 대체 코드 (GitHub suggestion 블록으로 렌더링된다) */
  suggestion: z.string().nullish(),
})

export type RawFinding = z.infer<typeof findingSchema>

/**
 * 인라인 쓰레드에 다는 답글. 본문만 있으면 되고, 코드로 답할 수 있을 때만 suggestion이 붙는다.
 */
export const replySchema = z.object({
  reply: z.string().min(1),
  suggestion: z.string().nullish(),
})

export type RawReply = z.infer<typeof replySchema>

export const reviewResultSchema = z.object({
  summary: z.string().default(''),
  findings: z.array(findingSchema).default([]),
})

export type ReviewResult = z.infer<typeof reviewResultSchema>

/** 위치 검증까지 마친, 실제로 게시할 지적 사항 */
export interface Finding {
  file: string
  line: number
  endLine?: number
  severity: Severity
  title: string
  detail: string
  suggestion?: string
  /** 인라인 위치 검증에 실패해 요약에만 싣는 경우 */
  inlineDropped?: boolean
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: '🔴 critical',
  major: '🟠 major',
  minor: '🟡 minor',
  nit: '⚪ nit',
}
