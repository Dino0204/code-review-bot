import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasReviewTrigger } from '../src/review/commands'

test('접두사만 있는 줄이면 리뷰한다', () => {
  assert.equal(hasReviewTrigger('/review'), true)
})

test('뒤에 말이 붙어도 리뷰한다', () => {
  assert.equal(hasReviewTrigger('/review 동시성 위주로 봐줘'), true)
  assert.equal(hasReviewTrigger('/review help'), true)
})

test('여러 줄 코멘트에서도 트리거 줄을 찾는다', () => {
  assert.equal(hasReviewTrigger(['이 부분 좀 봐줘', '', '/review', '고마워'].join('\n')), true)
})

test('문장 안에 섞인 접두사에는 반응하지 않는다', () => {
  assert.equal(hasReviewTrigger('경로는 /review 디렉터리에 있어'), false)
  assert.equal(hasReviewTrigger('LGTM 👍'), false)
})

test('접두사가 붙은 다른 명령에는 반응하지 않는다', () => {
  assert.equal(hasReviewTrigger('/reviewer'), false)
})

test('트리거 접두사를 바꿀 수 있다', () => {
  assert.equal(hasReviewTrigger('/gsml', '/gsml'), true)
  assert.equal(hasReviewTrigger('/review', '/gsml'), false)
})
