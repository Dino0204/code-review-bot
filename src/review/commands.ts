export type Command =
  | { name: 'review'; focus: string; full: boolean }
  | { name: 'ask'; question: string }
  | { name: 'summary' }
  | { name: 'learn' }
  | { name: 'help' }

const ALIASES = ['/ask', '/summary', '/learn'] as const

/**
 * 코멘트 본문에서 봇 명령을 찾아낸다.
 *
 *   /review                 diff 전체 리뷰
 *   /review security        관심 영역을 지정한 리뷰
 *   /review full            이전 지적을 무시하고 처음부터 다시
 *   /review ask 왜 이렇게?   PR + 코드베이스 맥락 질의
 *   /review summary         PR 요약
 *   /review learn           코드베이스 메모리 갱신
 *   /review help            도움말
 *
 * `/ask`, `/summary`, `/learn` 은 축약형으로도 받는다.
 */
export function parseCommand(body: string, triggerPrefix = '/review'): Command | undefined {
  const lines = body.split('\n').map((line) => line.trim())

  for (const line of lines) {
    if (!line.startsWith('/')) continue

    for (const alias of ALIASES) {
      if (line === alias || line.startsWith(`${alias} `)) {
        const rest = line.slice(alias.length).trim()
        if (alias === '/ask') return rest ? { name: 'ask', question: rest } : { name: 'help' }
        if (alias === '/summary') return { name: 'summary' }
        return { name: 'learn' }
      }
    }

    if (line !== triggerPrefix && !line.startsWith(`${triggerPrefix} `)) continue

    const rest = line.slice(triggerPrefix.length).trim()
    if (!rest) return { name: 'review', focus: '', full: false }

    const [first, ...restWords] = rest.split(/\s+/)
    const sub = (first ?? '').toLowerCase()
    const remainder = restWords.join(' ')

    switch (sub) {
      case 'help':
      case '-h':
      case '--help':
        return { name: 'help' }
      case 'summary':
        return { name: 'summary' }
      case 'learn':
        return { name: 'learn' }
      case 'ask':
        return remainder ? { name: 'ask', question: remainder } : { name: 'help' }
      case 'full':
      case 'all':
        return { name: 'review', focus: remainder, full: true }
      default:
        return { name: 'review', focus: rest, full: false }
    }
  }

  return undefined
}

export function helpText(triggerPrefix: string, model: string): string {
  return [
    `### 🤖 코드 리뷰 봇 사용법 (\`${model}\`)`,
    '',
    '| 명령 | 설명 |',
    '| --- | --- |',
    `| \`${triggerPrefix}\` | 변경된 diff를 리뷰한다 |`,
    `| \`${triggerPrefix} security\` | 특정 관점(security, performance, 동시성 …)에 집중해 리뷰한다 |`,
    `| \`${triggerPrefix} full\` | 이전 지적을 무시하고 처음부터 다시 리뷰한다 |`,
    `| \`${triggerPrefix} ask <질문>\` 또는 \`/ask <질문>\` | PR과 코드베이스 맥락을 근거로 답한다 |`,
    `| \`${triggerPrefix} summary\` 또는 \`/summary\` | PR 변경 사항을 요약한다 |`,
    `| \`${triggerPrefix} learn\` 또는 \`/learn\` | 이 PR에서 배운 내용을 코드베이스 메모리에 반영한다 |`,
    `| \`${triggerPrefix} help\` | 이 도움말 |`,
    '',
    '설정은 리포지토리의 `.reviewbot/config.yml`, 아키텍처 맥락은 `.reviewbot/context.md`에서 읽는다.',
  ].join('\n')
}
