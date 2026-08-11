import type { ZodType } from 'zod'
import { describeNetworkError } from './net'
import { log } from './logger'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface TokenUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  /** true면 response_format: json_object 로 요청 */
  json?: boolean
}

export class LlmError extends Error {
  /**
   * 구조화된 JSON으로 파싱하지 못했을 때도, 모델이 만든 원문(think 블록 제외)은 남아 있다.
   * 이건 GSML 서버의 규격 위반이 아니라 우리 쪽 JSON 추출 로직의 한계이므로,
   * 호출부가 원하면 이 원문을 그대로 게시하는 등으로 구제할 수 있게 노출한다.
   */
  readonly rawContent?: string

  constructor(message: string, rawContent?: string) {
    super(message)
    this.name = 'LlmError'
    this.rawContent = rawContent
  }
}

interface ChatCompletion {
  choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  error?: { message?: string }
}

export interface LlmClientOptions {
  apiKey: string
  baseUrl?: string
  model: string
  timeoutMs?: number
}

/**
 * OpenAI 호환 chat completion 클라이언트.
 *
 * 호출하고 응답을 파싱하는 것이 전부다. 규격을 벗어난 응답은 그대로 실패한다 —
 * 서버가 규격을 지키게 하는 것이 클라이언트가 우회하는 것보다 낫다.
 */
export class LlmClient {
  readonly model: string
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number

  /** 이번 실행에서 누적된 토큰 사용량 */
  readonly totalUsage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

  constructor(options: LlmClientOptions) {
    if (!options.apiKey) throw new LlmError('API 키가 비어 있다')
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? 'http://ssh.gsmsv.site:26145/v1').replace(/\/+$/, '')
    this.model = options.model
    this.timeoutMs = options.timeoutMs ?? 600_000
  }

  private async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: false,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 8192,
    }
    if (options.json) body['response_format'] = { type: 'json_object' }

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new LlmError(`모델 서버 네트워크 오류: ${describeNetworkError(error)}`)
    }

    const text = await response.text()
    if (!response.ok) throw new LlmError(`모델 서버 HTTP ${response.status}: ${text.slice(0, 500)}`)

    let data: ChatCompletion
    try {
      data = JSON.parse(text) as ChatCompletion
    } catch {
      throw new LlmError(`모델 응답이 JSON이 아니다: ${text.slice(0, 300)}`)
    }
    if (data.error?.message) throw new LlmError(`모델 오류: ${data.error.message}`)

    if (data.usage) {
      this.totalUsage.prompt_tokens += data.usage.prompt_tokens ?? 0
      this.totalUsage.completion_tokens += data.usage.completion_tokens ?? 0
      this.totalUsage.total_tokens += data.usage.total_tokens ?? 0
    }

    const content = data.choices?.[0]?.message?.content ?? ''
    if (!content.trim()) {
      throw new LlmError(`모델이 빈 응답을 반환했다 (finish_reason=${data.choices?.[0]?.finish_reason ?? 'unknown'})`)
    }
    return content
  }

  /** JSON 응답을 스키마로 검증해서 돌려준다. */
  async chatJson<T>(messages: ChatMessage[], schema: ZodType<T>, options: ChatOptions = {}): Promise<T> {
    const content = await this.chat(messages, { ...options, json: true })
    log.debug(`모델 원문 응답\n${content}`)

    const cleaned = stripThinkBlock(content)
    const json = extractJsonObject(cleaned)
    if (json === undefined) {
      throw new LlmError(`응답에서 JSON 객체를 찾지 못했다.${evidence(content, cleaned)}`, cleaned)
    }

    // extractJsonObject는 이미 JSON.parse가 되는 후보만 돌려준다
    const parsed: unknown = JSON.parse(json)

    const result = schema.safeParse(parsed)
    if (result.success) return result.data
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new LlmError(`응답이 스키마와 맞지 않는다 — ${issues}${evidence(content, json)}`, cleaned)
  }
}

/**
 * 파싱 실패를 눈으로 볼 수 있게 근거를 붙인다.
 *
 * 실패했다는 사실만 남기면 서버를 고칠 근거가 없다. 특히 이 모델은 본문 앞에
 * `<think>` 블록을 붙이고 그 안에 답안 초안을 적어보는데, 초안이 먼저 나오면
 * extractJsonObject가 그쪽을 집는다 — 그 경우를 바로 알아볼 수 있게 표시한다.
 */
function evidence(raw: string, attempted: string): string {
  const parts = [`\n--- 파싱하려던 내용 ---\n${attempted.slice(0, 600)}`]
  if (raw.includes('<think>') && !raw.includes('</think>')) {
    parts.push('\n(응답이 <think> 블록 안에서 잘렸다 — 답변까지 못 갔을 수 있다. 전체 원문은 REVIEWBOT_DEBUG=1 로 볼 수 있다)')
  }
  return parts.join('')
}

/**
 * `<think>...</think>` 블록을 걷어낸다. 이 모델은 항상 본문 앞에 추론을 붙이는데,
 * 리뷰 대상 diff에 템플릿 리터럴(`${...}`)이 있으면 추론 중 그 코드를 인용하다가
 * `{`가 실제 답변보다 먼저 나타나 extractJsonObject를 오도할 수 있다.
 * 태그가 닫히지 않았으면(응답 잘림) 원문을 그대로 둔다 — 그 경우는 파싱이 실패하는 게 맞다.
 */
export function stripThinkBlock(raw: string): string {
  const end = raw.indexOf('</think>')
  return end === -1 ? raw : raw.slice(end + '</think>'.length)
}

/**
 * 코드펜스/설명이 섞여 있어도 실제로 JSON.parse가 되는 첫 번째 균형 잡힌 객체를 뽑아낸다.
 * think 블록을 걷어내도, 모델이 답변 앞에 diff 속 코드를 인용하는 일이 있어 — 그 코드의
 * `{`가 먼저 걸리면 균형은 맞아도 JSON이 아니다. 그런 후보는 버리고 다음 `{`부터 다시 찾는다.
 * 문자열 리터럴 안의 중괄호는 무시한다.
 */
export function extractJsonObject(raw: string): string | undefined {
  const text = raw.trim()
  let searchFrom = 0

  while (searchFrom < text.length) {
    const start = text.indexOf('{', searchFrom)
    if (start === -1) return undefined

    const end = findBalancedBraceEnd(text, start)
    if (end === undefined) {
      searchFrom = start + 1
      continue
    }

    const candidate = text.slice(start, end + 1)
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      searchFrom = end + 1
    }
  }
  return undefined
}

function findBalancedBraceEnd(text: string, start: number): number | undefined {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return undefined
}
