import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BotConfig } from '../config'
import type { ExistingComment } from '../github/client'
import { truncate } from './budget'

// 이미 게시된 코멘트를 자기 것으로 알아보는 표식이다. 바꾸면 과거 코멘트를 못 찾아
// 같은 지적을 다시 달게 되므로, 모델 제공자가 바뀌어도 이 문자열은 그대로 둔다.
export const BOT_MARKER = '<!-- glm-code-review-bot -->'

export interface CodebaseMemory {
  /** 사람이 관리하는 컨텍스트 (아키텍처, 도메인 용어, 리뷰 규칙) */
  curated: string
  /** 봇이 /review learn 으로 축적한 메모리 */
  learned: string
}

export function loadCodebaseMemory(workspace: string, config: BotConfig): CodebaseMemory {
  return {
    curated: readIfExists(join(workspace, config.contextFile), 12_000),
    learned: readIfExists(join(workspace, config.memoryFile), 12_000),
  }
}

function readIfExists(path: string, maxChars: number): string {
  if (!existsSync(path)) return ''
  try {
    return truncate(readFileSync(path, 'utf8').trim(), maxChars)
  } catch {
    return ''
  }
}

export interface PrHistory {
  /** 이 PR에서 봇이 이미 지적한 내용 — 중복 코멘트를 막는다 */
  previousFindings: string
  /** 사람이 남긴 논의 — 이미 합의된 사항을 다시 지적하지 않게 한다 */
  discussion: string
}

/**
 * PR 대화 이력을 리뷰 컨텍스트로 변환한다.
 * 봇 코멘트와 사람 코멘트를 나눠서 넘겨야 모델이 "이미 말한 것 / 사람이 반박한 것"을 구분한다.
 */
export function buildPrHistory(
  issueComments: ExistingComment[],
  reviewComments: ExistingComment[],
  maxChars = 8000,
): PrHistory {
  const botLines: string[] = []
  const humanLines: string[] = []

  for (const comment of reviewComments) {
    const location = comment.path ? `${comment.path}:${comment.line ?? '?'}` : '(위치 없음)'
    const text = `- [${location}] ${comment.author}: ${collapse(comment.body, 400)}`
    if (isBotComment(comment)) botLines.push(text)
    else humanLines.push(text)
  }

  for (const comment of issueComments) {
    if (comment.body.trimStart().startsWith('/')) continue // 트리거 명령은 이력에서 제외
    const text = `- ${comment.author}: ${collapse(comment.body, 400)}`
    if (isBotComment(comment)) botLines.push(text)
    else humanLines.push(text)
  }

  return {
    previousFindings: truncate(botLines.join('\n'), maxChars),
    discussion: truncate(humanLines.join('\n'), maxChars),
  }
}

export function isBotComment(comment: ExistingComment): boolean {
  return comment.isBot || comment.body.includes(BOT_MARKER)
}

function collapse(text: string, maxChars: number): string {
  const flat = text
    .replace(BOT_MARKER, '')
    .replace(/```[\s\S]*?```/g, '[코드블록]')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat
}

/** 메모리 파일에 새 내용을 병합할 때 쓰는 헤더 */
export function memoryFileTemplate(body: string, prNumber: number, prTitle: string): string {
  return [
    '# 코드베이스 메모리',
    '',
    '> 코드 리뷰 봇이 `/review learn` 으로 갱신하는 파일이다.',
    '> 사람이 직접 편집해도 되며, 다음 학습 때 기존 내용을 근거로 병합된다.',
    '',
    body.trim(),
    '',
    '---',
    `마지막 갱신: PR #${prNumber} (${prTitle})`,
    '',
  ].join('\n')
}
