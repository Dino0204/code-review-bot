/** 문자 수로 토큰을 근사한다. 한국어/코드 혼합 기준 대략 3~4자 = 1토큰. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

export function truncate(text: string, maxChars: number, note = '이후 생략'): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n… (${note})`
}

/** 앞뒤를 남기고 가운데를 잘라낸다 — 파일 헤더(import)와 말미를 모두 보존하고 싶을 때 */
export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const head = Math.floor(maxChars * 0.6)
  const tail = maxChars - head
  return `${text.slice(0, head)}\n… (중략 ${text.length - maxChars}자) …\n${text.slice(-tail)}`
}

/**
 * 예산 안에서 항목을 순서대로 담는다. 넘치면 그 뒤 항목은 버리고 몇 개가 잘렸는지 알려준다.
 */
export function packWithinBudget<T>(
  items: T[],
  render: (item: T) => string,
  maxChars: number,
): { text: string; used: number; dropped: number } {
  const parts: string[] = []
  let total = 0
  let used = 0

  for (const item of items) {
    const rendered = render(item)
    if (total + rendered.length > maxChars && used > 0) break
    parts.push(rendered)
    total += rendered.length
    used++
  }

  return { text: parts.join('\n\n'), used, dropped: items.length - used }
}
