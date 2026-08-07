import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitReasoning, extractJsonObject } from '../src/llm/client'

test('추론 블록을 떼어내고 본문만 남긴다', () => {
  const raw = '<think>\n음, JSON을 내보내야겠다.\n</think>\n\n{"verdict":"comment"}'
  const { content, reasoning } = splitReasoning(raw)
  assert.equal(content, '{"verdict":"comment"}')
  assert.equal(reasoning, '음, JSON을 내보내야겠다.')
})

test('추론 블록 안의 JSON을 본문으로 오인하지 않는다', () => {
  // 이 모델은 추론 중에 답안 초안을 그대로 적어 본다. 블록을 안 떼면 초안이 파싱된다.
  const raw = [
    '<think>',
    '초안: {"verdict":"approve","findings":[]}',
    '아니다, 지적을 하나 넣어야 한다.',
    '</think>',
    '',
    '{"verdict":"request_changes","findings":[{"file":"a.ts"}]}',
  ].join('\n')
  const { content } = splitReasoning(raw)
  const parsed = JSON.parse(extractJsonObject(content)!) as { verdict: string }
  assert.equal(parsed.verdict, 'request_changes')
})

test('추론 블록이 없으면 원문 그대로다', () => {
  const { content, reasoning } = splitReasoning('{"verdict":"approve"}')
  assert.equal(content, '{"verdict":"approve"}')
  assert.equal(reasoning, undefined)
})

test('닫는 태그가 없으면 추론 도중 잘린 것이라 본문이 비어 있다', () => {
  const { content, reasoning } = splitReasoning('<think>\n한참 생각하다가 예산이 끊겼')
  assert.equal(content.trim(), '')
  assert.ok(reasoning?.includes('예산이 끊겼'))
})
