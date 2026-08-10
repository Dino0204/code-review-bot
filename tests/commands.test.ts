import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCommand } from '../src/review/commands'

test('기본 트리거', () => {
  assert.deepEqual(parseCommand('/review'), { name: 'review', focus: '' })
})

test('관심 영역을 붙인 리뷰', () => {
  assert.deepEqual(parseCommand('/review 동시성 이슈 위주로'), {
    name: 'review',
    focus: '동시성 이슈 위주로',
  })
})

test('ask는 축약형과 서브커맨드 모두 지원한다', () => {
  assert.deepEqual(parseCommand('/ask 이 락이 필요한가?'), { name: 'ask', question: '이 락이 필요한가?' })
  assert.deepEqual(parseCommand('/review ask 이 락이 필요한가?'), { name: 'ask', question: '이 락이 필요한가?' })
})

test('질문이 비면 도움말로 떨어진다', () => {
  assert.deepEqual(parseCommand('/ask'), { name: 'help' })
})

test('summary / help', () => {
  assert.deepEqual(parseCommand('/summary'), { name: 'summary' })
  assert.deepEqual(parseCommand('/review help'), { name: 'help' })
})

test('없어진 서브커맨드는 관심 영역으로 취급된다', () => {
  assert.deepEqual(parseCommand('/review learn'), { name: 'review', focus: 'learn' })
  assert.deepEqual(parseCommand('/review full'), { name: 'review', focus: 'full' })
})

test('여러 줄 코멘트에서도 명령 줄을 찾는다', () => {
  const body = ['이 부분 좀 봐줘', '', '/review security', '고마워'].join('\n')
  assert.deepEqual(parseCommand(body), { name: 'review', focus: 'security' })
})

test('명령이 없으면 undefined', () => {
  assert.equal(parseCommand('LGTM 👍'), undefined)
  assert.equal(parseCommand('경로는 /review 디렉터리에 있어'), undefined)
})

test('트리거 접두사를 바꿀 수 있다', () => {
  assert.deepEqual(parseCommand('/gsml', '/gsml'), { name: 'review', focus: '' })
  assert.equal(parseCommand('/review', '/gsml'), undefined)
})
