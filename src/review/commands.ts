export type Command = { name: 'review'; focus: string } | { name: 'help' }

/**
 * 코멘트 본문에서 봇 명령을 찾아낸다.
 *
 *   /review              diff 전체 리뷰
 *   /review security     관심 영역을 지정한 리뷰
 *   /review help         도움말
 *
 * 접두사 뒤에 오는 나머지 말은 전부 관심 영역으로 넘긴다.
 */
export function parseCommand(body: string, triggerPrefix = '/review'): Command | undefined {
  const lines = body.split('\n').map((line) => line.trim())

  for (const line of lines) {
    if (!line.startsWith('/')) continue
    if (line !== triggerPrefix && !line.startsWith(`${triggerPrefix} `)) continue

    const rest = line.slice(triggerPrefix.length).trim()
    if (!rest) return { name: 'review', focus: '' }

    const sub = (rest.split(/\s+/)[0] ?? '').toLowerCase()
    if (sub === 'help' || sub === '-h' || sub === '--help') return { name: 'help' }

    return { name: 'review', focus: rest }
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
    `| \`${triggerPrefix} help\` | 이 도움말 |`,
    '',
    'PR이 열리거나 갱신되면 자동으로 리뷰한다. 설정은 리포지토리의 `.reviewbot/config.yml` 에서 읽는다.',
  ].join('\n')
}
