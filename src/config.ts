import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { log } from './logger'

export const SEVERITIES = ['critical', 'major', 'minor', 'nit'] as const
export type Severity = (typeof SEVERITIES)[number]

export interface BotConfig {
  /** 모델 ID */
  model: string
  /** 기본 모델이 용량 부족으로 막힐 때 순서대로 시도할 대체 모델 */
  fallbackModels: string[]
  /** OpenAI 호환 API base URL (버전 경로까지 포함) */
  baseUrl: string
  /** 리뷰 코멘트 언어 */
  language: string
  temperature: number
  maxOutputTokens: number

  /** 프롬프트 1회 호출에 실어보낼 최대 문자 수 (대략 4자 ≈ 1토큰) */
  maxPromptChars: number
  /** 리뷰 대상 최대 파일 수 */
  maxFiles: number
  /** 파일 하나를 컨텍스트에 넣을 때의 최대 문자 수 */
  maxFileChars: number
  /** import 그래프/심볼 검색으로 끌어올 관련 파일 최대 개수 */
  maxRelatedFiles: number

  /** 리뷰에서 제외할 glob */
  exclude: string[]
  /** 지정 시 이 glob에 매칭되는 파일만 리뷰 */
  include: string[]

  /** PR open/synchronize 시 자동 리뷰 */
  autoReview: boolean
  /** 이 심각도 미만은 코멘트하지 않음 */
  minSeverity: Severity
  /** 인라인 코멘트 최대 개수 */
  maxInlineComments: number
  /** 낮은 확신도의 지적은 버림 (0~1) */
  minConfidence: number

  /** 코멘트 트리거 접두사 */
  triggerPrefix: string

  /** 사람이 관리하는 코드베이스 컨텍스트 파일 */
  contextFile: string
  /** 봇이 축적하는 학습 메모리 파일 */
  memoryFile: string
  /** /learn 실행 시 메모리 파일을 기본 브랜치에 커밋할지 */
  memoryAutoCommit: boolean

  /** 리포지토리별 추가 리뷰 지침 */
  customInstructions: string
}

export const DEFAULT_CONFIG: BotConfig = {
  // GSML 게이트웨이는 모델 하나만 서빙한다. 모델 ID는 /v1/models 로 확인한다.
  model: 'darwin-35b-q4_k_m.gguf',
  // 단일 모델이라 넘어갈 곳이 없다. 여러 모델을 서빙하는 게이트웨이로 바꾸면 여기에 채운다.
  fallbackModels: [],
  baseUrl: 'http://ssh.gsmsv.site:26145/v1',
  language: 'ko',
  temperature: 0.2,
  // 이 모델은 추론을 끌 수 없고, 그 추론 토큰이 max_tokens를 함께 소비한다.
  // 부족하면 응답이 잘리므로 넉넉히 잡는다 — 잘리면 클라이언트가 예산을 두 배로 올려 한 번 더 시도한다.
  maxOutputTokens: 16384,

  // 컨텍스트 창은 131,072토큰이고 출력도 여기서 나눠 쓴다.
  // 코드 기준 대략 3.5자 ≈ 1토큰이라 이 값이 4만 토큰 언저리다 — 출력 예산을 빼도 여유가 있다.
  maxPromptChars: 140_000,
  maxFiles: 40,
  maxFileChars: 24_000,
  maxRelatedFiles: 12,

  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/out/**',
    '**/.next/**',
    '**/coverage/**',
    '**/vendor/**',
    '**/*.min.js',
    '**/*.map',
    '**/*.snap',
    '**/*.lock',
    '**/package-lock.json',
    '**/pnpm-lock.yaml',
    '**/yarn.lock',
    '**/*.png',
    '**/*.jpg',
    '**/*.jpeg',
    '**/*.gif',
    '**/*.svg',
    '**/*.ico',
    '**/*.pdf',
    '**/*.woff*',
  ],
  include: [],

  autoReview: true,
  minSeverity: 'minor',
  maxInlineComments: 25,
  minConfidence: 0.5,

  triggerPrefix: '/review',

  contextFile: '.reviewbot/context.md',
  memoryFile: '.reviewbot/memory.md',
  memoryAutoCommit: false,

  customInstructions: '',
}

/** 리포지토리 루트의 설정 파일 후보 (먼저 발견된 것 하나만 사용) */
const CONFIG_FILES = ['.reviewbot/config.yml', '.reviewbot/config.yaml', '.reviewbot.yml', '.reviewbot.yaml']

function coerceStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((v): v is string => typeof v === 'string')
}

function pickFileConfig(raw: unknown): Partial<BotConfig> {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const out: Partial<BotConfig> = {}

  const strings = ['model', 'baseUrl', 'language', 'triggerPrefix', 'contextFile', 'memoryFile', 'customInstructions'] as const
  for (const key of strings) {
    if (typeof r[key] === 'string') out[key] = r[key] as string
  }

  const numbers = [
    'temperature',
    'maxOutputTokens',
    'maxPromptChars',
    'maxFiles',
    'maxFileChars',
    'maxRelatedFiles',
    'maxInlineComments',
    'minConfidence',
  ] as const
  for (const key of numbers) {
    if (typeof r[key] === 'number' && Number.isFinite(r[key])) out[key] = r[key] as number
  }

  const booleans = ['autoReview', 'memoryAutoCommit'] as const
  for (const key of booleans) {
    if (typeof r[key] === 'boolean') out[key] = r[key] as boolean
  }

  const exclude = coerceStringArray(r['exclude'])
  if (exclude) out.exclude = [...DEFAULT_CONFIG.exclude, ...exclude]
  const include = coerceStringArray(r['include'])
  if (include) out.include = include
  const fallbackModels = coerceStringArray(r['fallbackModels'])
  if (fallbackModels) out.fallbackModels = fallbackModels

  if (typeof r['minSeverity'] === 'string' && (SEVERITIES as readonly string[]).includes(r['minSeverity'])) {
    out.minSeverity = r['minSeverity'] as Severity
  }

  return out
}

function envOverrides(): Partial<BotConfig> {
  const env = process.env
  const out: Partial<BotConfig> = {}
  if (env['REVIEWBOT_MODEL']) out.model = env['REVIEWBOT_MODEL']
  if (env['REVIEWBOT_FALLBACK_MODELS'] !== undefined) {
    out.fallbackModels = env['REVIEWBOT_FALLBACK_MODELS']
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean)
  }
  if (env['REVIEWBOT_BASE_URL']) out.baseUrl = env['REVIEWBOT_BASE_URL']
  if (env['REVIEWBOT_LANGUAGE']) out.language = env['REVIEWBOT_LANGUAGE']
  if (env['REVIEWBOT_TRIGGER_PREFIX']) out.triggerPrefix = env['REVIEWBOT_TRIGGER_PREFIX']
  if (env['REVIEWBOT_MIN_SEVERITY'] && (SEVERITIES as readonly string[]).includes(env['REVIEWBOT_MIN_SEVERITY'])) {
    out.minSeverity = env['REVIEWBOT_MIN_SEVERITY'] as Severity
  }
  if (env['REVIEWBOT_AUTO_REVIEW']) out.autoReview = env['REVIEWBOT_AUTO_REVIEW'] !== 'false'
  if (env['REVIEWBOT_MAX_FILES']) {
    const n = Number(env['REVIEWBOT_MAX_FILES'])
    if (Number.isFinite(n)) out.maxFiles = n
  }
  if (env['REVIEWBOT_INSTRUCTIONS']) out.customInstructions = env['REVIEWBOT_INSTRUCTIONS']
  return out
}

/**
 * 설정 병합 순서: 기본값 → 리포지토리 설정 파일 → 환경변수(액션 input)
 */
export function loadConfig(workspace: string): BotConfig {
  let fromFile: Partial<BotConfig> = {}
  for (const candidate of CONFIG_FILES) {
    const path = resolve(workspace, candidate)
    if (!existsSync(path)) continue
    try {
      fromFile = pickFileConfig(parseYaml(readFileSync(path, 'utf8')))
      log.info(`설정 파일 로드: ${candidate}`)
    } catch (error) {
      log.warn(`설정 파일 파싱 실패(${candidate}): ${(error as Error).message} — 기본값을 사용한다`)
    }
    break
  }

  return { ...DEFAULT_CONFIG, ...fromFile, ...envOverrides() }
}

export function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity)
}

/** severity가 기준치 이상인가 (critical이 가장 높음) */
export function meetsSeverity(severity: Severity, threshold: Severity): boolean {
  return severityRank(severity) <= severityRank(threshold)
}
