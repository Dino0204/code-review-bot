export type Command =
  | { name: 'review'; focus: string }
  | { name: 'ask'; question: string }
  | { name: 'summary' }
  | { name: 'help' }

const ALIASES = ['/ask', '/summary'] as const

/**
 * 코멘트 본문에서 봇 명령을 찾아낸다.
 *
 *   /review                 diff 전체 리뷰
 *   /review security        관심 영역을 지정한 리뷰
 *   /review ask 왜 이렇게?   PR 맥락 질의
 *   /review summary         PR 요약
 *   /review help            도움말
 *
 * `/ask`, `/summary` 는 축약형으로도 받는다.
 */
export function parseCommand(body: string, triggerPrefix = '/review'): Command | undefined {
  const lines = body.split('\n').map((line) => line.trim())

  for (const line of lines) {
    if (!line.startsWith('/')) continue

    for (const alias of ALIASES) {
      if (line === alias || line.startsWith(`${alias} `)) {
        const rest = line.slice(alias.length).trim()
        if (alias === '/ask') return rest ? { name: 'ask', question: rest } : { name: 'help' }
        return { name: 'summary' }
      }
    }

    if (line !== triggerPrefix && !line.startsWith(`${triggerPrefix} `)) continue

    const rest = line.slice(triggerPrefix.length).trim()
    if (!rest) return { name: 'review', focus: '' }

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
      case 'ask':
        return remainder ? { name: 'ask', question: remainder } : { name: 'help' }
      default:
        return { name: 'review', focus: rest }
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
    `| \`${triggerPrefix} ask <질문>\` 또는 \`/ask <질문>\` | PR 변경 사항을 근거로 답한다 |`,
    `| \`${triggerPrefix} summary\` 또는 \`/summary\` | PR 변경 사항을 요약한다 |`,
    `| \`${triggerPrefix} help\` | 이 도움말 |`,
    '',
    '설정은 리포지토리의 `.reviewbot/config.yml` 에서 읽는다.',
  ].join('\n')
}
