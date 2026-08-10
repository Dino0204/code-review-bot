/**
 * 코멘트 본문에 리뷰 트리거가 들어 있는지 판단한다.
 *
 *   /review
 *
 * 명령은 이것 하나뿐이다. 접두사만 있는 줄이거나 접두사로 시작하는 줄이면 리뷰를 돌린다.
 * 뒤에 붙는 말은 무시한다 — `경로는 /review 디렉터리에 있어` 처럼 문장 안에 섞인
 * 접두사에 반응하지 않도록 줄 맨 앞에 있을 때만 인정한다.
 */
export function hasReviewTrigger(body: string, triggerPrefix = '/review'): boolean {
  return body
    .split('\n')
    .map((line) => line.trim())
    .some((line) => line === triggerPrefix || line.startsWith(`${triggerPrefix} `))
}
