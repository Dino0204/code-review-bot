import type { ZodType } from 'zod'
import { log } from '../logger'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface GlmUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cached_tokens?: number
}

export interface ChatResult {
  content: string
  reasoning?: string
  finishReason?: string
  usage?: GlmUsage
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  /** chain-of-thought 모드 */
  thinking?: boolean
  /** true면 response_format: json_object 로 요청 */
  json?: boolean
  stop?: string[]
}

export class GlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string | number,
    readonly retriable = false,
  ) {
    super(message)
    this.name = 'GlmError'
  }
}

interface GlmChoice {
  index?: number
  finish_reason?: string
  message?: { role?: string; content?: string | null; reasoning_content?: string | null }
}

interface GlmResponse {
  id?: string
  choices?: GlmChoice[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
  code?: number | string
  message?: string
  error?: { code?: number | string; message?: string }
}

const RETRIABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504])

export interface GlmClientOptions {
  apiKey: string
  baseUrl?: string
  model: string
  timeoutMs?: number
  maxRetries?: number
}

/**
 * z.ai(GLM) chat completion 클라이언트.
 * OpenAI SDK를 쓰지 않고 fetch로 직접 호출한다 — 코드가 OpenAI 인프라를 거치지 않는 것이 요구사항.
 */
export class GlmClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly model: string
  private readonly timeoutMs: number
  private readonly maxRetries: number

  /** 이번 실행에서 누적된 토큰 사용량 */
  readonly totalUsage: GlmUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

  constructor(options: GlmClientOptions) {
    if (!options.apiKey) throw new GlmError('ZAI_API_KEY가 비어 있다')
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? 'https://api.z.ai/api/paas/v4').replace(/\/+$/, '')
    this.model = options.model
    this.timeoutMs = options.timeoutMs ?? 180_000
    this.maxRetries = options.maxRetries ?? 4
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: false,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 8192,
    }
    if (options.thinking !== undefined) {
      body['thinking'] = { type: options.thinking ? 'enabled' : 'disabled' }
    }
    if (options.json) {
      body['response_format'] = { type: 'json_object' }
    }
    if (options.stop?.length) body['stop'] = options.stop.slice(0, 4)

    let lastError: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(30_000, 2 ** attempt * 1000) + Math.floor(Math.random() * 500)
        log.warn(`GLM 호출 재시도 ${attempt}/${this.maxRetries} — ${delay}ms 대기`)
        await sleep(delay)
      }
      try {
        return this.record(await this.request(body))
      } catch (error) {
        lastError = error
        const retriable = error instanceof GlmError ? error.retriable : true
        if (!retriable) throw error
      }
    }
    throw lastError instanceof Error ? lastError : new GlmError('GLM 호출 실패')
  }

  /**
   * JSON 응답을 스키마로 검증해서 돌려준다.
   * 1차 파싱이 깨지면 모델에게 원문을 주고 한 번 교정을 요청한다.
   */
  async chatJson<T>(messages: ChatMessage[], schema: ZodType<T>, options: ChatOptions = {}): Promise<T> {
    const first = await this.chat(messages, { ...options, json: true })
    const parsed = tryParse(first.content, schema)
    if (parsed.ok) return parsed.value

    log.warn(`GLM JSON 파싱 실패 — 교정 요청: ${parsed.error}`)
    const repaired = await this.chat(
      [
        ...messages,
        { role: 'assistant', content: first.content.slice(0, 20_000) },
        {
          role: 'user',
          content: [
            '위 응답이 요구된 JSON 스키마를 만족하지 못했다.',
            `오류: ${parsed.error}`,
            '설명이나 코드펜스 없이, 스키마를 만족하는 JSON 객체 하나만 다시 출력하라.',
          ].join('\n'),
        },
      ],
      { ...options, json: true },
    )

    const second = tryParse(repaired.content, schema)
    if (second.ok) return second.value
    throw new GlmError(`GLM 응답을 JSON으로 파싱하지 못했다: ${second.error}`)
  }

  private record(result: ChatResult): ChatResult {
    if (result.usage) {
      this.totalUsage.prompt_tokens += result.usage.prompt_tokens
      this.totalUsage.completion_tokens += result.usage.completion_tokens
      this.totalUsage.total_tokens += result.usage.total_tokens
    }
    return result
  }

  private async request(body: Record<string, unknown>): Promise<ChatResult> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'Accept-Language': 'en-US,en',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      // 네트워크 오류/타임아웃은 재시도 대상
      throw new GlmError(`GLM 네트워크 오류: ${(error as Error).message}`, undefined, undefined, true)
    }

    const text = await response.text()
    if (!response.ok) {
      const detail = extractErrorMessage(text) ?? text.slice(0, 500)
      throw new GlmError(
        `GLM HTTP ${response.status}: ${detail}`,
        response.status,
        undefined,
        RETRIABLE_STATUS.has(response.status),
      )
    }

    let data: GlmResponse
    try {
      data = JSON.parse(text) as GlmResponse
    } catch {
      throw new GlmError(`GLM 응답이 JSON이 아니다: ${text.slice(0, 300)}`, response.status, undefined, true)
    }

    // z.ai는 HTTP 200에 body로 에러를 실어 보내는 경우가 있다
    if (data.error?.message || (data.code !== undefined && data.code !== 200 && !data.choices)) {
      const message = data.error?.message ?? data.message ?? 'unknown error'
      const code = data.error?.code ?? data.code
      throw new GlmError(`GLM 오류(${String(code)}): ${message}`, response.status, code, String(code) === '1302')
    }

    const choice = data.choices?.[0]
    const content = choice?.message?.content ?? ''
    if (!content.trim()) {
      const reason = choice?.finish_reason ?? 'unknown'
      throw new GlmError(`GLM이 빈 응답을 반환했다 (finish_reason=${reason})`, response.status, reason, reason !== 'sensitive')
    }

    return {
      content,
      reasoning: choice?.message?.reasoning_content ?? undefined,
      finishReason: choice?.finish_reason,
      usage: data.usage
        ? {
            prompt_tokens: data.usage.prompt_tokens ?? 0,
            completion_tokens: data.usage.completion_tokens ?? 0,
            total_tokens: data.usage.total_tokens ?? 0,
            cached_tokens: data.usage.prompt_tokens_details?.cached_tokens,
          }
        : undefined,
    }
  }
}

function extractErrorMessage(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as GlmResponse
    return parsed.error?.message ?? parsed.message
  } catch {
    return undefined
  }
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

function tryParse<T>(raw: string, schema: ZodType<T>): ParseResult<T> {
  const json = extractJsonObject(raw)
  if (json === undefined) return { ok: false, error: 'JSON 객체를 찾지 못했다' }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(json)
  } catch (error) {
    return { ok: false, error: `JSON.parse 실패: ${(error as Error).message}` }
  }

  const result = schema.safeParse(parsedJson)
  if (result.success) return { ok: true, value: result.data }
  const issues = result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
  return { ok: false, error: `스키마 불일치 — ${issues}` }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
