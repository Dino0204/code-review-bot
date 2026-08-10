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
  constructor(message: string) {
    super(message)
    this.name = 'LlmError'
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

    const json = extractJsonObject(content)
    if (json === undefined) {
      throw new LlmError(`응답에서 JSON 객체를 찾지 못했다.${evidence(content, content)}`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch (error) {
      throw new LlmError(`JSON.parse 실패: ${(error as Error).message}${evidence(content, json)}`)
    }

    const result = schema.safeParse(parsed)
    if (result.success) return result.data
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new LlmError(`응답이 스키마와 맞지 않는다 — ${issues}${evidence(content, json)}`)
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
  if (raw.includes('<think>')) {
    parts.push('\n(응답에 <think> 블록이 있다 — 추론 속 초안을 집었을 수 있다. 전체 원문은 REVIEWBOT_DEBUG=1 로 볼 수 있다)')
  }
  return parts.join('')
}

/**
 * 코드펜스/설명이 섞여 있어도 첫 번째 균형 잡힌 JSON 객체를 뽑아낸다.
 * 문자열 리터럴 안의 중괄호는 무시한다.
 */
export function extractJsonObject(raw: string): string | undefined {
  const text = raw.trim()
  const start = text.indexOf('{')
  if (start === -1) return undefined

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
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return undefined
}
