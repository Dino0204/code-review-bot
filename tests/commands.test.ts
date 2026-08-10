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

test('help는 별도 명령이고, 그 밖의 말은 전부 관심 영역이다', () => {
  assert.deepEqual(parseCommand('/review help'), { name: 'help' })
  assert.deepEqual(parseCommand('/review --help'), { name: 'help' })
  assert.deepEqual(parseCommand('/review summary'), { name: 'review', focus: 'summary' })
  assert.deepEqual(parseCommand('/review ask 이게 뭐야'), { name: 'review', focus: 'ask 이게 뭐야' })
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
