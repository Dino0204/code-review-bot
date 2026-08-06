import type { ChatMessage } from '../glm/client'
import type { BotConfig } from '../config'
import type { PullRequestInfo } from '../github/client'
import type { DiffFile } from '../github/diff'
import { renderFileDiff } from '../github/diff'
import type { RepoMap } from '../context/repoMap'
import type { CodebaseMemory, PrHistory } from '../context/memory'
import type { FileSnapshot, RelatedFile } from '../context/retriever'
import { truncate } from '../context/budget'
import { CATEGORIES } from './schema'
import { SEVERITIES } from '../config'

export interface ReviewContext {
  config: BotConfig
  pr: PullRequestInfo
  diffFiles: DiffFile[]
  changedFiles: FileSnapshot[]
  relatedFiles: RelatedFile[]
  repoMap: RepoMap
  memory: CodebaseMemory
  history: PrHistory
  /** 사용자가 지정한 관심 영역 */
  focus: string
  /** true면 이전 지적 이력을 무시하고 처음부터 리뷰 */
  full: boolean
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

export function buildSystemPrompt(config: BotConfig): string {
  return [
    '너는 시니어 소프트웨어 엔지니어이자 코드 리뷰어다. GitHub Pull Request를 리뷰한다.',
    '',
    '## 원칙',
    '1. 이번 diff에서 **새로 추가되거나 수정된 줄** 때문에 생기는 문제만 지적한다. 기존 코드에 대한 일반적인 불만은 쓰지 않는다.',
    '2. 근거 없는 추측을 쓰지 않는다. 주어진 코드에서 확인 가능한 사실만 근거로 삼는다.',
    '3. 실제로 동작이 깨지거나 유지보수를 해치는 문제를 우선한다. 취향 차이나 사소한 포맷은 리뷰하지 않는다.',
    '4. 같은 문제를 여러 줄에 걸쳐 반복해서 지적하지 않는다. 대표 위치 한 곳에만 남긴다.',
    '5. 이미 지적된 항목(이전 리뷰 이력)은 다시 지적하지 않는다. 고쳐졌다면 요약에서 짧게 언급만 한다.',
    '6. 확신이 없으면 confidence를 낮게 준다. 0.5 미만이면 아예 보고하지 않는다.',
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
    `  "verdict": "approve | comment | request_changes",`,
    '  "findings": [',
    '    {',
    '      "file": "리포지토리 루트 기준 경로",',
    '      "line": 42,',
    '      "end_line": 45,',
    `      "severity": "${SEVERITIES.join(' | ')}",`,
    `      "category": "${CATEGORIES.join(' | ')}",`,
    '      "title": "한 줄 요약",',
    '      "detail": "왜 문제인지와 어떻게 고칠지 (마크다운 허용)",',
    '      "suggestion": "대체 코드 또는 생략",',
    '      "confidence": 0.0',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    `title, detail, summary는 ${languageName(config.language)}로 작성한다. 코드/식별자/에러 메시지는 원문 그대로 둔다.`,
    '지적할 것이 없으면 findings를 빈 배열로 두고 verdict는 approve로 한다.',
  ].join('\n')
}

interface Section {
  title: string
  body: string
  /** 예산이 모자랄 때 잘라낼 수 있는 최소 보장 비율 (0이면 통째로 버려질 수 있음) */
  weight: number
}

/**
 * 우선순위가 높은 섹션부터 예산을 채운다.
 * diff가 커질수록 리포지토리 맵/관련 파일이 먼저 밀려나고, diff 자체는 마지막까지 남는다.
 */
function assemble(sections: Section[], budget: number): string {
  const parts: string[] = []
  let remaining = budget

  for (const section of sections) {
    if (!section.body.trim()) continue
    const header = `\n## ${section.title}\n`
    if (remaining <= header.length + 200) break

    const allowance = Math.max(0, Math.min(section.body.length, Math.floor(remaining * section.weight)))
    if (allowance < 200) continue

    const body = truncate(section.body, allowance)
    parts.push(header + body)
    remaining -= header.length + body.length
  }

  return parts.join('\n')
}

export function buildReviewMessages(context: ReviewContext): ChatMessage[] {
  const { config, pr, diffFiles } = context

  const diffText = diffFiles.map((file) => renderFileDiff(file, config.maxFileChars)).join('\n\n')

  const changedFilesText = context.changedFiles
    .map((file) => `--- ${file.path} (변경 후 전체 내용) ---\n\`\`\`\n${file.content}\n\`\`\``)
    .join('\n\n')

  const relatedFilesText = context.relatedFiles
    .map((file) => `--- ${file.path} (${file.reason}) ---\n\`\`\`\n${file.content}\n\`\`\``)
    .join('\n\n')

  const repoContext = [
    context.repoMap.tree && `### 디렉터리 구조\n${context.repoMap.tree}`,
    context.repoMap.manifests && `### 빌드/의존성\n${context.repoMap.manifests}`,
    context.repoMap.docs && `### 리포지토리 문서\n${context.repoMap.docs}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const memoryText = [
    context.memory.curated && `### 팀이 관리하는 코드베이스 컨텍스트\n${context.memory.curated}`,
    context.memory.learned && `### 봇이 축적한 코드베이스 메모리\n${context.memory.learned}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const historyText = context.full
    ? ''
    : [
        context.history.previousFindings && `### 봇이 이미 지적한 내용 (반복 금지)\n${context.history.previousFindings}`,
        context.history.discussion && `### PR 논의 (이미 합의된 사항은 다시 꺼내지 않는다)\n${context.history.discussion}`,
      ]
        .filter(Boolean)
        .join('\n\n')

  const prMeta = [
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

  // 예산 배분: diff가 가장 중요하므로 먼저, 그다음 메모리 → 이력 → 변경 파일 → 관련 파일 → 리포 맵
  const sections: Section[] = [
    { title: 'Pull Request', body: prMeta, weight: 0.1 },
    { title: '코드베이스 메모리', body: memoryText, weight: 0.15 },
    { title: '변경 사항 (diff)', body: diffText, weight: 0.55 },
    { title: '이전 리뷰 이력', body: historyText, weight: 0.15 },
    { title: '변경된 파일의 현재 전체 내용', body: changedFilesText, weight: 0.45 },
    { title: '관련 코드 (import 그래프 · 호출부)', body: relatedFilesText, weight: 0.5 },
    { title: '리포지토리 개요', body: repoContext, weight: 0.6 },
  ]

  const instructions = [
    context.focus ? `이번 리뷰의 관심 영역: **${context.focus}** — 이 관점을 우선해서 보되, 명백한 결함은 영역 밖이라도 지적한다.` : '',
    config.customInstructions ? `리포지토리 추가 지침:\n${config.customInstructions}` : '',
    context.full ? '이전 리뷰 이력을 무시하고 diff 전체를 처음부터 리뷰한다.' : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const userPrompt = [
    '아래 Pull Request를 리뷰하라.',
    assemble(sections, config.maxPromptChars),
    instructions ? `\n## 추가 지시\n${instructions}` : '',
    '\n지정된 JSON 형식으로만 응답하라.',
  ].join('\n')

  return [
    { role: 'system', content: buildSystemPrompt(config) },
    { role: 'user', content: userPrompt },
  ]
}

export function buildAskMessages(context: ReviewContext, question: string): ChatMessage[] {
  const diffText = context.diffFiles.map((file) => renderFileDiff(file, context.config.maxFileChars)).join('\n\n')

  const sections: Section[] = [
    { title: 'Pull Request', body: `제목: ${context.pr.title}\n\n${truncate(context.pr.body || '(없음)', 2000)}`, weight: 0.1 },
    {
      title: '코드베이스 메모리',
      body: [context.memory.curated, context.memory.learned].filter(Boolean).join('\n\n'),
      weight: 0.2,
    },
    { title: '변경 사항 (diff)', body: diffText, weight: 0.5 },
    {
      title: '관련 코드',
      body: context.relatedFiles.map((file) => `--- ${file.path} (${file.reason}) ---\n\`\`\`\n${file.content}\n\`\`\``).join('\n\n'),
      weight: 0.5,
    },
    { title: '대화 이력', body: context.history.discussion, weight: 0.4 },
    { title: '리포지토리 개요', body: context.repoMap.tree, weight: 0.5 },
  ]

  return [
    {
      role: 'system',
      content: [
        '너는 이 리포지토리를 잘 아는 시니어 엔지니어다. PR과 코드베이스 맥락을 근거로 질문에 답한다.',
        '- 주어진 코드에서 확인되는 사실만 근거로 답한다. 모르면 모른다고 말한다.',
        '- 파일과 줄 번호를 인용해 근거를 밝힌다.',
        '- 마크다운으로 간결하게 답한다. JSON을 쓰지 않는다.',
        `- ${languageName(context.config.language)}로 답한다.`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [assemble(sections, context.config.maxPromptChars), '\n## 질문', question].join('\n'),
    },
  ]
}

export function buildSummaryMessages(context: ReviewContext): ChatMessage[] {
  const diffText = context.diffFiles.map((file) => renderFileDiff(file, context.config.maxFileChars)).join('\n\n')

  return [
    {
      role: 'system',
      content: [
        '너는 시니어 엔지니어다. Pull Request의 변경 내용을 리뷰어가 빠르게 파악할 수 있도록 요약한다.',
        '',
        '다음 마크다운 구조로 작성한다:',
        '### 변경 요약  — 이 PR이 무엇을 왜 바꾸는지 3~5줄',
        '### 주요 변경  — 파일/모듈 단위 불릿, 각 줄에 무엇이 바뀌었는지',
        '### 리뷰 포인트 — 리뷰어가 특히 봐야 할 지점 2~4개',
        '',
        '추측을 쓰지 않는다. diff에서 확인되는 내용만 쓴다.',
        `${languageName(context.config.language)}로 작성한다.`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `제목: ${context.pr.title}`,
        `본문:\n${truncate(context.pr.body || '(없음)', 2000)}`,
        '',
        '## 변경 사항 (diff)',
        truncate(diffText, Math.floor(context.config.maxPromptChars * 0.7)),
      ].join('\n'),
    },
  ]
}

export function buildLearnMessages(context: ReviewContext): ChatMessage[] {
  const diffText = context.diffFiles.map((file) => renderFileDiff(file, 6000)).join('\n\n')

  return [
    {
      role: 'system',
      content: [
        '너는 코드 리뷰 봇의 장기 기억을 관리한다.',
        '이 리포지토리를 처음 보는 리뷰어가 알아야 할 **지속적으로 유효한** 사실만 정리한다.',
        '',
        '포함할 것: 아키텍처와 모듈 경계, 도메인 용어, 팀의 코딩 규약, 자주 반복되는 실수 패턴,',
        '건드리면 위험한 영역, 테스트/배포 방식.',
        '제외할 것: 특정 PR에서만 유효한 세부 사항, 개별 버그, 시간이 지나면 틀려질 내용.',
        '',
        '기존 메모리가 주어지면 **그것을 기반으로 갱신**한다. 여전히 유효한 항목은 유지하고,',
        '틀린 항목은 고치고, 새로 알게 된 것만 추가한다. 전체를 다시 쓰지 않는다.',
        '',
        '마크다운 본문만 출력한다 (제목 `#` 은 붙이지 않는다). 30줄을 넘기지 않는다.',
        `${languageName(context.config.language)}로 작성한다.`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '## 기존 메모리',
        context.memory.learned || '(아직 없음)',
        '',
        '## 팀이 관리하는 컨텍스트',
        context.memory.curated || '(없음)',
        '',
        '## 리포지토리 개요',
        context.repoMap.tree,
        '',
        context.repoMap.manifests,
        '',
        '## 이번 PR',
        `제목: ${context.pr.title}`,
        truncate(diffText, Math.floor(context.config.maxPromptChars * 0.4)),
        '',
        '## PR 논의',
        context.history.discussion || '(없음)',
        '',
        '위 내용을 반영해 갱신된 메모리 본문을 출력하라.',
      ].join('\n'),
    },
  ]
}
