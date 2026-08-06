import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCommand } from '../src/review/commands'

test('기본 트리거', () => {
  assert.deepEqual(parseCommand('/review'), { name: 'review', focus: '', full: false })
})

test('관심 영역을 붙인 리뷰', () => {
  assert.deepEqual(parseCommand('/review 동시성 이슈 위주로'), {
    name: 'review',
    focus: '동시성 이슈 위주로',
    full: false,
  })
})

test('full 서브커맨드', () => {
  assert.deepEqual(parseCommand('/review full'), { name: 'review', focus: '', full: true })
  assert.deepEqual(parseCommand('/review full security'), { name: 'review', focus: 'security', full: true })
})

test('ask는 축약형과 서브커맨드 모두 지원한다', () => {
  assert.deepEqual(parseCommand('/ask 이 락이 필요한가?'), { name: 'ask', question: '이 락이 필요한가?' })
  assert.deepEqual(parseCommand('/review ask 이 락이 필요한가?'), { name: 'ask', question: '이 락이 필요한가?' })
})

test('질문이 비면 도움말로 떨어진다', () => {
  assert.deepEqual(parseCommand('/ask'), { name: 'help' })
})

test('summary / learn / help', () => {
  assert.deepEqual(parseCommand('/summary'), { name: 'summary' })
  assert.deepEqual(parseCommand('/learn'), { name: 'learn' })
  assert.deepEqual(parseCommand('/review help'), { name: 'help' })
})

test('여러 줄 코멘트에서도 명령 줄을 찾는다', () => {
  const body = ['이 부분 좀 봐줘', '', '/review security', '고마워'].join('\n')
  assert.deepEqual(parseCommand(body), { name: 'review', focus: 'security', full: false })
})

test('명령이 없으면 undefined', () => {
  assert.equal(parseCommand('LGTM 👍'), undefined)
  assert.equal(parseCommand('경로는 /review 디렉터리에 있어'), undefined)
})

test('트리거 접두사를 바꿀 수 있다', () => {
  assert.deepEqual(parseCommand('/glm', '/glm'), { name: 'review', focus: '', full: false })
  assert.equal(parseCommand('/review', '/glm'), undefined)
})
