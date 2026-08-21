import { parse as parseYaml } from 'yaml'
import { log } from './logger'

export const SEVERITIES = ['critical', 'major', 'minor', 'nit'] as const
export type Severity = (typeof SEVERITIES)[number]

export interface BotConfig {
  /** 모델 ID */
  model: string
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

  /** diff와 함께 변경된 파일의 현재 내용도 싣는다 */
  includeSources: boolean
  /** 파일 하나의 현재 내용에 쓸 최대 문자 수 */
  maxSourceChars: number
  /** 모델이 read_file로 더 읽어갈 수 있는 파일 수 (0이면 도구를 주지 않는다) */
  maxExtraReads: number

  /** 리뷰에서 제외할 glob */
  exclude: string[]
  /** 지정 시 이 glob에 매칭되는 파일만 리뷰 */
  include: string[]

  /** PR open/reopen/ready_for_review 시 자동 리뷰 — 이후 푸시(synchronize)는 재리뷰하지 않는다 */
  autoReview: boolean
  /** 이 심각도 미만은 코멘트하지 않음 */
  minSeverity: Severity
  /** 인라인 코멘트 최대 개수 */
  maxInlineComments: number

  /** 코멘트 트리거 접두사 */
  triggerPrefix: string

  /** 인라인 리뷰 쓰레드에서 봇을 멘션하면 답글을 단다 */
  threadReply: boolean
}

/**
 * 인라인 쓰레드에서 봇을 부르는 이름. 이 이름 하나에만 반응한다.
 *
 * 리포지토리별로 바꿀 수 없게 상수로 둔다 — 부르는 이름이 리포마다 다르면
 * 사람이 어디서 뭐라고 불러야 하는지 알 수 없고, 설정을 읽기 전에는 걸러낼 수도 없다.
 */
export const BOT_MENTION = 'itplay-code-review-bot'

export const DEFAULT_CONFIG: BotConfig = {
  // GSML 게이트웨이는 모델 하나만 서빙한다. 모델 ID는 /v1/models 로 확인한다.
  model: 'darwin-35b-q4_k_m.gguf',
  // 단일 모델이라 넘어갈 곳이 없다. 여러 모델을 서빙하는 게이트웨이로 바꾸면 여기에 채운다.
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

  // diff만 주면 헝크 밖을 알 수 없어, 손대지 않은 줄을 새로 생긴 것으로 읽는 오탐이 나온다.
  // 원본을 함께 실으면 프롬프트가 커지지만 그만큼 지적의 근거가 확실해진다.
  includeSources: true,
  maxSourceChars: 16_000,
  maxExtraReads: 6,

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

  triggerPrefix: '/review',

  threadReply: true,
}

/** 리포지토리 루트의 설정 파일 후보 (먼저 발견된 것 하나만 사용) */
export const CONFIG_FILES = ['.reviewbot/config.yml', '.reviewbot/config.yaml', '.reviewbot.yml', '.reviewbot.yaml']

/**
 * 리포지토리 루트의 코딩 지침 문서 후보 (먼저 발견된 것 하나만 사용).
 *
 * 사람과 다른 코딩 에이전트가 이미 쓰고 있는 문서를 그대로 리뷰 기준으로 삼는다 —
 * 리뷰 전용 지침을 따로 관리하면 둘이 어긋난다.
 */
export const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md']

function coerceStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((v): v is string => typeof v === 'string')
}

function pickFileConfig(raw: unknown): Partial<BotConfig> {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const out: Partial<BotConfig> = {}

  const strings = ['model', 'baseUrl', 'language', 'triggerPrefix'] as const
  for (const key of strings) {
    if (typeof r[key] === 'string') out[key] = r[key] as string
  }

  const numbers = [
    'temperature',
    'maxOutputTokens',
    'maxPromptChars',
    'maxFiles',
    'maxFileChars',
    'maxSourceChars',
    'maxExtraReads',
    'maxInlineComments',
  ] as const
  for (const key of numbers) {
    if (typeof r[key] === 'number' && Number.isFinite(r[key])) out[key] = r[key] as number
  }

  if (typeof r['autoReview'] === 'boolean') out.autoReview = r['autoReview']
  if (typeof r['threadReply'] === 'boolean') out.threadReply = r['threadReply']
  if (typeof r['includeSources'] === 'boolean') out.includeSources = r['includeSources']

  const exclude = coerceStringArray(r['exclude'])
  if (exclude) out.exclude = [...DEFAULT_CONFIG.exclude, ...exclude]
  const include = coerceStringArray(r['include'])
  if (include) out.include = include

  if (typeof r['minSeverity'] === 'string' && (SEVERITIES as readonly string[]).includes(r['minSeverity'])) {
    out.minSeverity = r['minSeverity'] as Severity
  }

  return out
}

function envOverrides(): Partial<BotConfig> {
  const env = process.env
  const out: Partial<BotConfig> = {}
  if (env['REVIEWBOT_MODEL']) out.model = env['REVIEWBOT_MODEL']
  if (env['REVIEWBOT_BASE_URL']) out.baseUrl = env['REVIEWBOT_BASE_URL']
  if (env['REVIEWBOT_LANGUAGE']) out.language = env['REVIEWBOT_LANGUAGE']
  if (env['REVIEWBOT_TRIGGER_PREFIX']) out.triggerPrefix = env['REVIEWBOT_TRIGGER_PREFIX']
  if (env['REVIEWBOT_MIN_SEVERITY'] && (SEVERITIES as readonly string[]).includes(env['REVIEWBOT_MIN_SEVERITY'])) {
    out.minSeverity = env['REVIEWBOT_MIN_SEVERITY'] as Severity
  }
  if (env['REVIEWBOT_AUTO_REVIEW']) out.autoReview = env['REVIEWBOT_AUTO_REVIEW'] !== 'false'
  if (env['REVIEWBOT_THREAD_REPLY']) out.threadReply = env['REVIEWBOT_THREAD_REPLY'] !== 'false'
  if (env['REVIEWBOT_INCLUDE_SOURCES']) out.includeSources = env['REVIEWBOT_INCLUDE_SOURCES'] !== 'false'
  if (env['REVIEWBOT_MAX_EXTRA_READS']) {
    const n = Number(env['REVIEWBOT_MAX_EXTRA_READS'])
    if (Number.isFinite(n)) out.maxExtraReads = n
  }
  if (env['REVIEWBOT_MAX_FILES']) {
    const n = Number(env['REVIEWBOT_MAX_FILES'])
    if (Number.isFinite(n)) out.maxFiles = n
  }
  return out
}

/**
 * 설정 병합 순서: 기본값 → 리포지토리 설정 파일 → 환경변수
 *
 * 설정 파일 내용은 호출부가 GitHub API로 읽어 넘긴다 — 리포지토리를 체크아웃하지 않는다.
 */
export function loadConfig(fileContent?: string): BotConfig {
  let fromFile: Partial<BotConfig> = {}
  if (fileContent !== undefined) {
    try {
      fromFile = pickFileConfig(parseYaml(fileContent))
    } catch (error) {
      log.warn(`설정 파일 파싱 실패: ${(error as Error).message} — 기본값을 사용한다`)
    }
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
