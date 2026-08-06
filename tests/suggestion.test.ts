import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderFindingComment, stripFence, usableSuggestion } from '../src/review/render'
import type { Finding } from '../src/review/schema'

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: 'src/a.ts',
    line: 10,
    severity: 'major',
    category: 'bug',
    title: '제목',
    detail: '설명',
    confidence: 0.9,
    ...overrides,
  }
}

test('코드 제안은 그대로 통과한다', () => {
  const code = "  return user.profile?.fullName?.split(' ')[0] ?? ''"
  assert.equal(usableSuggestion(finding({ suggestion: code })), code)
})

test('코드펜스로 감싼 제안은 펜스를 벗긴다', () => {
  const suggestion = '```ts\nconst x = 1\n```'
  assert.equal(usableSuggestion(finding({ suggestion })), 'const x = 1')
})

// 설명문이 suggestion 블록에 들어가면 "적용" 버튼이 코드를 문장으로 바꿔버린다
test('한국어 설명문은 제안으로 쓰지 않는다', () => {
  assert.equal(usableSuggestion(finding({ suggestion: '재시도 사이에 지연 시간을 추가하세요.' })), undefined)
  assert.equal(usableSuggestion(finding({ suggestion: 'null 체크를 추가해야 합니다' })), undefined)
})

test('코드를 인용한 설명문도 제안으로 쓰지 않는다', () => {
  const prose = "null 체크를 추가하세요: `return user.profile?.fullName ?? ''`"
  assert.equal(usableSuggestion(finding({ suggestion: prose })), undefined)
})

test('여러 줄 범위 지적에는 제안을 달지 않는다', () => {
  const code = 'const x = 1'
  assert.equal(usableSuggestion(finding({ suggestion: code, line: 10, endLine: 14 })), undefined)
  // 범위가 한 줄이면 허용
  assert.equal(usableSuggestion(finding({ suggestion: code, line: 10, endLine: 10 })), code)
})

test('제안이 없으면 undefined', () => {
  assert.equal(usableSuggestion(finding()), undefined)
  assert.equal(usableSuggestion(finding({ suggestion: '   ' })), undefined)
})

test('쓸 수 없는 제안은 버리지 않고 본문에 서술로 남긴다', () => {
  const body = renderFindingComment(finding({ suggestion: '재시도 사이에 지연 시간을 추가하세요.' }))
  assert.ok(!body.includes('```suggestion'), body)
  assert.ok(body.includes('**제안:** 재시도 사이에 지연 시간을 추가하세요.'), body)
})

test('쓸 수 있는 제안은 suggestion 블록으로 렌더링한다', () => {
  const body = renderFindingComment(finding({ suggestion: 'const x = 1' }))
  assert.ok(body.includes('```suggestion\nconst x = 1\n```'), body)
})

test('확신도가 낮으면 오탐 가능성을 덧붙인다', () => {
  const body = renderFindingComment(finding({ confidence: 0.55 }))
  assert.match(body, /확신도 55%/)
})

test('stripFence는 언어 태그가 있어도 벗긴다', () => {
  assert.equal(stripFence('```typescript\nfoo()\n```'), 'foo()')
  assert.equal(stripFence('foo()'), 'foo()')
})
