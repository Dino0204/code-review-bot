/**
 * fetch가 던진 오류에서 실제로 무슨 일이 있었는지 뽑아낸다.
 *
 * undici는 DNS 실패든 연결 거부든 인증서 오류든 전부 "fetch failed"로 던지고,
 * 구체적인 내용은 cause에 넣는다. 그대로 로그에 찍으면 원인을 알 수 없다.
 */
export function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return '응답 시간 초과'

  const cause = (error as { cause?: unknown }).cause
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code
    const hint = code ? NETWORK_HINTS[code] : undefined
    return [code, cause.message, hint && `— ${hint}`].filter(Boolean).join(' ')
  }
  return error.message
}

/** 자주 나오는 오류에 대한 사람 말 설명 */
const NETWORK_HINTS: Record<string, string> = {
  ENOTFOUND: 'DNS로 주소를 못 찾았다. 컨테이너의 DNS 설정을 확인해야 한다',
  EAI_AGAIN: 'DNS 조회가 실패했다. 컨테이너의 DNS 설정을 확인해야 한다',
  ECONNREFUSED: '연결이 거부됐다',
  ETIMEDOUT: '연결이 시간 초과됐다. 방화벽이 막고 있을 수 있다',
  ECONNRESET: '연결이 끊겼다. 중간에서 차단됐을 수 있다',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: '인증서를 검증하지 못했다. 중간에서 TLS를 가로채는 장비가 있을 수 있다',
  SELF_SIGNED_CERT_IN_CHAIN: '자체 서명 인증서가 끼어 있다. TLS를 가로채는 장비가 있을 수 있다',
}
