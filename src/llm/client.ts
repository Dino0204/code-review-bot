import type { ZodType } from 'zod'
import { describeNetworkError } from '../net'
import { log } from '../logger'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface TokenUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cached_tokens?: number
}

export interface ChatResult {
  /** 추론 블록을 걷어낸 본문 */
  content: string
  /** 모델이 본문 앞에 흘린 추론 과정 */
  reasoning?: string
  finishReason?: string
  /** 출력 예산에 걸려 응답이 잘렸는가 */
  truncated: boolean
  /** 이 응답을 받는 데 실제로 쓴 max_tokens — 내부 재시도로 올라갔을 수 있다 */
  outputBudget: number
  usage?: TokenUsage
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  /** true면 response_format: json_object 로 요청 */
  json?: boolean
  stop?: string[]
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string | number,
    readonly retriable = false,
    /** 서버가 Retry-After로 알려준 대기 시간 */
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

interface ChatChoice {
  index?: number
  finish_reason?: string
  message?: { role?: string; content?: string | null; reasoning_content?: string | null }
}

interface ChatCompletion {
  id?: string
  choices?: ChatChoice[]
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

/**
 * 잘린 응답을 살리려고 출력 예산을 올릴 때의 상한.
 * 컨텍스트 창을 프롬프트와 나눠 쓰므로 무한정 올릴 수는 없다.
 */
const MAX_OUTPUT_CEILING = 32_768

export interface LlmClientOptions {
  apiKey: string
  baseUrl?: string
  model: string
  /** 기본 모델이 계속 거절될 때 순서대로 시도할 대체 모델 */
  fallbackModels?: string[]
  timeoutMs?: number
  maxRetries?: number
}

/**
 * 재시도를 다 쓴 뒤 다른 모델로 넘어가볼 가치가 있는 오류인가.
 *
 * 용량 부족(429/503)은 물론이고 네트워크 오류와 타임아웃도 포함한다 —
 * 혼잡한 모델은 요청을 받아두고 응답하지 않는데, 한산한 모델에서는 곧바로 처리된다.
 * 반대로 출력 예산 초과는 모델을 바꿔도 같은 결과라 제외된다.
 */
function shouldTryNextModel(error: unknown): boolean {
  if (!(error instanceof LlmError)) return false
  if (error.code === 'length') return false
  if (error.retriable) return true
  return error.status === 429 || error.status === 503
}

/** 추론이 출력 예산을 통째로 먹고 본문을 못 낸 상태 */
function isTruncated(error: unknown): boolean {
  return error instanceof LlmError && error.code === 'length'
}

/**
 * OpenAI 호환 chat completion 클라이언트.
 * OpenAI SDK를 쓰지 않고 fetch로 직접 호출한다 — 코드가 OpenAI 인프라를 거치지 않는 것이 요구사항.
 *
 * 기본 대상인 GSML 게이트웨이는 llama.cpp 서버라 OpenAI 규격에서 두 가지가 어긋난다.
 * 이 클라이언트가 그 차이를 흡수한다.
 * 1. 추론을 `reasoning_content` 로 분리하지 않고 본문 앞에 `<think>...</think>` 로 붙여 보낸다
 * 2. 출력이 잘려도 `finish_reason` 이 `stop` 으로 온다 — 사용량으로 직접 판별해야 한다
 */
export class LlmClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly model: string
  private readonly fallbackModels: string[]
  private readonly timeoutMs: number
  private readonly maxRetries: number

  /** 이번 실행에서 누적된 토큰 사용량 */
  readonly totalUsage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  /** 실제로 응답을 준 모델 — 폴백이 걸리면 기본 모델과 다르다 */
  lastUsedModel: string

  constructor(options: LlmClientOptions) {
    if (!options.apiKey) throw new LlmError('API 키가 비어 있다')
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? 'http://ssh.gsmsv.site:26145/v1').replace(/\/+$/, '')
    this.model = options.model
    this.lastUsedModel = options.model
    this.fallbackModels = (options.fallbackModels ?? []).filter((model) => model !== options.model)
    // 큰 프롬프트를 추론까지 켜고 돌리면 몇 분씩 걸린다. 그리고 동시 실행 슬롯이 적은 서버에서는
    // 클라이언트가 타임아웃으로 끊어도 서버는 계속 처리하며 슬롯을 물고 있다 —
    // 성급하게 끊으면 슬롯만 낭비하고 스스로를 막는다. 넉넉히 기다린다.
    this.timeoutMs = options.timeoutMs ?? 600_000
    // 슬롯이 차 있으면 429가 흔하다. 모델당 이만큼 버티고 다음 모델로 넘어간다.
    this.maxRetries = options.maxRetries ?? 4
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      messages,
      stream: false,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 8192,
    }
    if (options.json) {
      body['response_format'] = { type: 'json_object' }
    }
    if (options.stop?.length) body['stop'] = options.stop.slice(0, 4)

    // 기본 모델이 계속 막히면 대체 모델로 넘어간다. 단일 모델 게이트웨이에서는 폴백이 비어 있다.
    const models = [this.model, ...this.fallbackModels]
    let lastError: unknown

    for (const [index, model] of models.entries()) {
      try {
        const result = await this.attemptModel(model, body)
        if (index > 0) log.warn(`${this.model}이(가) 막혀 ${model}로 리뷰했다`)
        this.lastUsedModel = model
        return result
      } catch (error) {
        lastError = error
        // 인증 실패나 잘못된 요청이면 모델을 바꿔도 소용없다
        if (!shouldTryNextModel(error)) throw error
        if (index < models.length - 1) {
          log.warn(`${model} 사용 불가(${(error as Error).message}) — 다음 모델로 전환한다`)
        }
      }
    }

    throw lastError instanceof Error ? lastError : new LlmError('모델 호출 실패')
  }

  /**
   * 한 모델로 시도한다.
   *
   * 추론이 max_tokens를 통째로 먹고 본문을 못 내는 경우가 있다(작은 diff에서도 발생).
   * 추론을 끌 수 있는 모델이 아니므로 예산을 늘려 한 번 더 시도한다.
   */
  private async attemptModel(model: string, body: Record<string, unknown>): Promise<ChatResult> {
    try {
      return await this.withRetries({ ...body, model })
    } catch (error) {
      if (!isTruncated(error)) throw error
      const raised = raiseBudget(body['max_tokens'])
      if (raised === undefined) throw error
      log.warn(`${model}의 추론이 출력 예산을 소진했다 — max_tokens를 ${raised}로 올려 다시 시도한다`)
      return this.withRetries({ ...body, model, max_tokens: raised })
    }
  }

  private async withRetries(body: Record<string, unknown>): Promise<ChatResult> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // 동시 실행 슬롯을 점유한 다른 리뷰는 몇 분씩 걸리므로, 몇 초 뒤에 다시 두드려봐야 낭비다.
        // 8초에서 시작해 1분까지 벌린다.
        const serverHint = lastError instanceof LlmError ? lastError.retryAfterMs : undefined
        const backoff = Math.min(60_000, 2 ** (attempt - 1) * 8000) + Math.floor(Math.random() * 2000)
        const delay = Math.max(serverHint ?? 0, backoff)
        // 무엇 때문에 다시 부르는지 남긴다 — 이유 없이 기다리기만 하면 손댈 곳을 알 수 없다
        const reason = lastError instanceof Error ? lastError.message : String(lastError)
        log.warn(`모델 호출 재시도 ${attempt}/${this.maxRetries} (${Math.round(delay / 1000)}초 대기) — ${reason}`)
        await sleep(delay)
      }
      try {
        return this.record(await this.request(body))
      } catch (error) {
        lastError = error
        const retriable = error instanceof LlmError ? error.retriable : true
        if (!retriable) throw error
      }
    }
    throw lastError instanceof Error ? lastError : new LlmError('모델 호출 실패')
  }

  /**
   * JSON 응답을 스키마로 검증해서 돌려준다.
   * 응답이 잘려서 깨진 것이면 예산을 늘려 다시 부르고, 그 밖의 이유면 모델에게 교정을 요청한다.
   */
  async chatJson<T>(messages: ChatMessage[], schema: ZodType<T>, options: ChatOptions = {}): Promise<T> {
    const first = await this.chat(messages, { ...options, json: true })
    const parsed = tryParse(first.content, schema)
    if (parsed.ok) return parsed.value

    // 잘린 응답은 교정을 요청해도 같은 곳에서 다시 잘린다 — 예산을 늘려 처음부터 다시 받는다
    if (first.truncated) {
      const raised = raiseBudget(first.outputBudget)
      if (raised === undefined) {
        throw new LlmError(
          `응답이 출력 예산에 걸려 잘렸다 (${parsed.error}). maxFiles를 줄여 한 번에 리뷰하는 양을 낮춰야 한다.`,
          undefined,
          'length',
        )
      }
      log.warn(`JSON 응답이 잘렸다 — max_tokens를 ${raised}로 올려 다시 시도한다`)
      const retried = await this.chat(messages, { ...options, json: true, maxTokens: raised })
      const reparsed = tryParse(retried.content, schema)
      if (reparsed.ok) return reparsed.value
      throw new LlmError(
        `예산을 늘려도 응답이 잘렸다 (${reparsed.error}). maxFiles를 줄여야 한다.`,
        undefined,
        'length',
      )
    }

    log.warn(`JSON 파싱 실패 — 교정 요청: ${parsed.error}`)
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
    throw new LlmError(`응답을 JSON으로 파싱하지 못했다: ${second.error}`)
  }

  private record(result: ChatResult): ChatResult {
    if (result.usage) {
      this.totalUsage.prompt_tokens += result.usage.prompt_tokens
      this.totalUsage.completion_tokens += result.usage.completion_tokens
      this.totalUsage.total_tokens += result.usage.total_tokens
      // 호출마다 남긴다 — 하루 한도가 있는 키라, 다 끝난 뒤에 총량만 알면 늦다
      log.info(
        `모델 응답: ${result.usage.prompt_tokens} in / ${result.usage.completion_tokens} out` +
          `${result.truncated ? ' (잘림)' : ''} — 이번 실행 누적 ${this.totalUsage.total_tokens}`,
      )
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
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      // 네트워크 오류/타임아웃은 재시도 대상
      throw new LlmError(`모델 서버 네트워크 오류: ${describeNetworkError(error)}`, undefined, undefined, true)
    }

    const text = await response.text()
    if (!response.ok) {
      const detail = extractErrorMessage(text) ?? text.slice(0, 500)
      throw new LlmError(
        `모델 서버 HTTP ${response.status}: ${detail}`,
        response.status,
        undefined,
        RETRIABLE_STATUS.has(response.status),
        parseRetryAfter(response.headers.get('retry-after')),
      )
    }

    let data: ChatCompletion
    try {
      data = JSON.parse(text) as ChatCompletion
    } catch {
      throw new LlmError(`모델 응답이 JSON이 아니다: ${text.slice(0, 300)}`, response.status, undefined, true)
    }

    // 게이트웨이에 따라 HTTP 200에 body로 에러를 실어 보내는 경우가 있다
    if (data.error?.message || (data.code !== undefined && data.code !== 200 && !data.choices)) {
      const message = data.error?.message ?? data.message ?? 'unknown error'
      const code = data.error?.code ?? data.code
      throw new LlmError(`모델 오류(${String(code)}): ${message}`, response.status, code, false)
    }

    const choice = data.choices?.[0]
    const usage = data.usage
      ? {
          prompt_tokens: data.usage.prompt_tokens ?? 0,
          completion_tokens: data.usage.completion_tokens ?? 0,
          total_tokens: data.usage.total_tokens ?? 0,
          cached_tokens: data.usage.prompt_tokens_details?.cached_tokens,
        }
      : undefined

    // llama.cpp는 잘린 응답에도 finish_reason=stop을 준다. 출력이 예산에 정확히 닿았으면 잘린 것으로 본다.
    const budget = Number(body['max_tokens'])
    const hitBudget = usage !== undefined && Number.isFinite(budget) && usage.completion_tokens >= budget
    const truncated = choice?.finish_reason === 'length' || hitBudget

    const raw = choice?.message?.content ?? ''
    const split = splitReasoning(raw)
    // 서버가 규격대로 분리해 주면 그쪽을 쓴다
    const reasoning = choice?.message?.reasoning_content ?? split.reasoning

    if (!split.content.trim()) {
      const reason = truncated ? 'length' : (choice?.finish_reason ?? 'unknown')
      // 예산에 걸린 것이면 같은 조건으로 다시 불러도 같은 결과다 — 재시도 대상이 아니다
      const hint = truncated ? ' — 추론이 출력 예산을 소진했다' : ''
      throw new LlmError(
        `모델이 빈 응답을 반환했다 (finish_reason=${reason})${hint}`,
        response.status,
        reason,
        !truncated && reason !== 'sensitive',
      )
    }

    return {
      content: split.content,
      reasoning: reasoning ?? undefined,
      finishReason: choice?.finish_reason,
      truncated,
      outputBudget: Number.isFinite(budget) ? budget : 0,
      usage,
    }
  }
}

/** 출력 예산을 두 배로 올린다. 이미 상한이면 undefined — 더 시도해도 소용없다. */
function raiseBudget(current: unknown): number | undefined {
  const budget = Number(current)
  if (!Number.isFinite(budget) || budget <= 0) return undefined
  if (budget >= MAX_OUTPUT_CEILING) return undefined
  return Math.min(budget * 2, MAX_OUTPUT_CEILING)
}

/**
 * 본문 앞에 붙어 오는 `<think>...</think>` 추론 블록을 떼어낸다.
 *
 * 추론 블록 안에는 모델이 검토하던 JSON 조각이 그대로 들어 있는 경우가 많아서,
 * 떼어내지 않으면 본문 대신 추론 속 예시를 파싱하게 된다.
 * 닫는 태그가 없으면 추론 도중 잘린 것이므로 본문은 비어 있다.
 */
export function splitReasoning(raw: string): { content: string; reasoning?: string } {
  const open = raw.indexOf('<think>')
  if (open === -1) return { content: raw }

  const close = raw.indexOf('</think>', open)
  if (close === -1) return { content: raw.slice(0, open), reasoning: raw.slice(open + '<think>'.length) }

  const before = raw.slice(0, open)
  const reasoning = raw.slice(open + '<think>'.length, close)
  const after = raw.slice(close + '</think>'.length)
  return { content: (before + after).trim(), reasoning: reasoning.trim() }
}

/** Retry-After는 초 단위 정수 또는 HTTP 날짜 형식으로 온다 */
export function parseRetryAfter(raw: string | null): number | undefined {
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 120) * 1000
  const timestamp = Date.parse(raw)
  if (Number.isNaN(timestamp)) return undefined
  return Math.max(0, Math.min(timestamp - Date.now(), 120_000))
}

function extractErrorMessage(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as ChatCompletion
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
