import type { ChatMessage } from '../llm'
import type { BotConfig } from '../config'
import type { PullRequestInfo } from '../github/client'
import type { DiffFile } from '../github/diff'
import { renderFileDiff } from '../github/diff'
import { SEVERITIES } from '../config'

export interface ReviewContext {
  config: BotConfig
  pr: PullRequestInfo
  diffFiles: DiffFile[]
}

const LANGUAGE_LABEL: Record<string, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  zh: '中文',
}

function languageName(code: string): string {
  return LANGUAGE_LABEL[code] ?? code
}

/** 프롬프트가 컨텍스트 창을 넘지 않도록 뒤를 잘라낸다 */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n… (이후 생략)`
}

export function buildSystemPrompt(config: BotConfig): string {
  return [
    '너는 시니어 소프트웨어 엔지니어이자 코드 리뷰어다. GitHub Pull Request를 리뷰한다.',
    '',
    '## 원칙',
    '1. 이번 diff에서 **새로 추가되거나 수정된 줄** 때문에 생기는 문제만 지적한다. 기존 코드에 대한 일반적인 불만은 쓰지 않는다.',
    '2. 근거 없는 추측을 쓰지 않는다. 주어진 코드에서 확인 가능한 사실만 근거로 삼는다.',
    '3. 실제로 동작이 깨지거나 유지보수를 해치는 문제를 우선한다. 취향 차이나 사소한 포맷은 리뷰하지 않는다.',
    '4. 같은 문제를 여러 줄에 걸쳐 반복해서 지적하지 않는다. 대표 위치 한 곳에만 남긴다.',
    '5. 확신이 서지 않는 지적은 단정하지 말고 확인을 요청하는 어투로 쓴다. 확실한 문제만 단정해서 쓴다.',
    '   - ✗ "user가 null이라 여기서 터진다"  ← 근거가 부족한데 단정',
    '   - ✓ "user가 null인 경로가 있어 보이는데, 의도한 동작인지 확인해주세요"',
    '',
    '## 심각도',
    '- critical: 데이터 손실, 보안 취약점, 프로덕션 장애로 직결되는 결함',
    '- major: 특정 조건에서 확실히 잘못 동작하거나 심각한 성능/설계 문제',
    '- minor: 동작은 하지만 개선이 필요한 부분 (에러 처리 누락, 경계 조건, 가독성 저해)',
    '- nit: 사소한 제안. 남발하지 않는다',
    '',
    '## 줄 번호 규칙',
    'diff의 각 줄 왼쪽에 붙은 숫자가 **변경 후 파일의 줄 번호**다. `line` 필드에는 반드시 그 숫자를 쓴다.',
    '숫자가 비어 있는 줄(삭제된 줄)은 인라인 코멘트를 달 수 없으므로, 그 문제는 summary에 서술한다.',
    '',
    '## suggestion 필드',
    'GitHub에서 이 값은 "이 코드로 교체" 버튼이 된다. 따라서 **오직 소스 코드만** 들어갈 수 있다.',
    '`line` 줄을 그대로 대체할 수 있는 완성된 코드일 때만 채우고, 들여쓰기까지 정확히 맞춘다.',
    '아래는 모두 잘못된 예다 — 이렇게 쓰느니 필드를 생략하고 detail에 서술하라.',
    '- ✗ "null 체크를 추가하세요: `return user.profile?.name`"  ← 설명문',
    '- ✗ "재시도 사이에 지연을 두세요"  ← 설명문',
    '- ✗ "// 여기서 null을 확인할 것"  ← 주석만',
    '- ✓ "  return user.profile?.fullName?.split(\' \')[0] ?? \'\'"  ← 그대로 붙여넣을 수 있는 코드',
    '여러 줄에 걸친 지적(end_line 지정)에는 suggestion을 넣지 않는다.',
    '',
    '## 출력 형식',
    '설명 없이 아래 JSON 객체 하나만 출력한다.',
    '```json',
    '{',
    '  "summary": "변경 내용 요약과 전반적인 평가 (마크다운, 3~6줄)",',
    '  "findings": [',
    '    {',
    '      "file": "리포지토리 루트 기준 경로",',
    '      "line": 42,',
    '      "end_line": 45,',
    `      "severity": "${SEVERITIES.join(' | ')}",`,
    '      "title": "한 줄 요약",',
    '      "detail": "왜 문제인지와 어떻게 고칠지 (마크다운 허용)",',
    '      "suggestion": "대체 코드 또는 생략"',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    `title, detail, summary는 ${languageName(config.language)}로 작성한다. 코드/식별자/에러 메시지는 원문 그대로 둔다.`,
    '지적할 것이 없으면 findings를 빈 배열로 둔다.',
  ].join('\n')
}

function prMeta(pr: PullRequestInfo): string {
  return [
    `제목: ${pr.title}`,
    `작성자: ${pr.author}`,
    `브랜치: ${pr.headRef} → ${pr.baseRef}`,
    `변경량: ${pr.changedFiles}개 파일, +${pr.additions}/-${pr.deletions}`,
    pr.labels.length ? `라벨: ${pr.labels.join(', ')}` : '',
    '',
    'PR 본문:',
    truncate(pr.body || '(없음)', 3000),
  ]
    .filter(Boolean)
    .join('\n')
}

function renderDiff(context: ReviewContext): string {
  const text = context.diffFiles.map((file) => renderFileDiff(file, context.config.maxFileChars)).join('\n\n')
  // 시스템 프롬프트와 PR 메타가 쓰는 몫을 빼고 나머지를 diff에 준다
  return truncate(text, Math.floor(context.config.maxPromptChars * 0.85))
}

export function buildReviewMessages(context: ReviewContext): ChatMessage[] {
  const { config } = context

  const userPrompt = [
    '아래 Pull Request를 리뷰하라.',
    '',
    '## Pull Request',
    prMeta(context.pr),
    '',
    '## 변경 사항 (diff)',
    renderDiff(context),
    config.customInstructions ? `\n## 리포지토리 추가 지침\n${config.customInstructions}` : '',
    '\n지정된 JSON 형식으로만 응답하라.',
  ].join('\n')

  return [
    { role: 'system', content: buildSystemPrompt(config) },
    { role: 'user', content: userPrompt },
  ]
}

