import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, posix, basename, extname } from 'node:path'
import { minimatch } from 'minimatch'
import type { DiffFile } from '../github/diff'
import type { BotConfig } from '../config'
import { truncateMiddle } from './budget'
import { log } from '../logger'

export interface FileSnapshot {
  path: string
  content: string
  truncated: boolean
}

export interface RelatedFile extends FileSnapshot {
  /** 이 파일이 왜 컨텍스트에 포함됐는지 (프롬프트에 함께 실린다) */
  reason: string
}

const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

/** 맥락으로 실어 보낼 가치가 있는 파일 확장자. 락파일·번들·라이선스 같은 잡음을 걸러낸다. */
const CONTEXT_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS,
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.rb',
  '.php',
  '.cs',
  '.swift',
  '.scala',
  '.sql',
  '.graphql',
  '.gql',
  '.vue',
  '.svelte',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.md',
])

/** 생성물이라 읽어봐야 소용없는 파일 (번들·최소화 결과물 등) */
const GENERATED_PATTERNS = [/(^|\/)dist\//, /(^|\/)build\//, /\.min\.[cm]?js$/, /-lock\.json$/, /\.lock$/]
const RESOLVE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.d.ts',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
]

const IMPORT_PATTERNS = [
  /(?:^|\n)\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*export\s+(?:\*|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
]

const DECLARATION_PATTERN =
  /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/g

export function readFileSnapshot(workspace: string, path: string, maxChars: number): FileSnapshot | undefined {
  const absolute = join(workspace, path)
  if (!existsSync(absolute)) return undefined
  try {
    if (statSync(absolute).size > 2 * 1024 * 1024) return undefined
    const raw = readFileSync(absolute, 'utf8')
    if (raw.includes('\0')) return undefined // 바이너리
    const content = truncateMiddle(raw, maxChars)
    return { path, content, truncated: content.length !== raw.length }
  } catch {
    return undefined
  }
}

/** 변경된 파일의 현재(head) 전체 내용 — diff만으로는 보이지 않는 주변 로직을 보게 한다. */
export function readChangedFiles(workspace: string, diffFiles: DiffFile[], config: BotConfig): FileSnapshot[] {
  const snapshots: FileSnapshot[] = []
  for (const file of diffFiles) {
    if (file.status === 'deleted' || file.isBinary) continue
    const snapshot = readFileSnapshot(workspace, file.path, config.maxFileChars)
    if (snapshot) snapshots.push(snapshot)
  }
  return snapshots
}

function resolveRelativeImport(workspace: string, fromFile: string, specifier: string): string | undefined {
  const base = posix.normalize(posix.join(posix.dirname(fromFile), specifier))
  // TS 소스에서 `./foo.js`로 쓰는 ESM 관행을 흡수한다
  const candidates = [base, base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), ...RESOLVE_SUFFIXES.map((s) => base + s)]
  for (const candidate of candidates) {
    if (!candidate || candidate.startsWith('..')) continue
    const absolute = join(workspace, candidate)
    if (existsSync(absolute) && statSync(absolute).isFile()) return candidate
  }
  return undefined
}

interface TsPathAlias {
  prefix: string
  targets: string[]
}

function loadTsPathAliases(workspace: string): TsPathAlias[] {
  const tsconfigPath = join(workspace, 'tsconfig.json')
  if (!existsSync(tsconfigPath)) return []
  try {
    // tsconfig는 JSONC라 주석/트레일링 콤마를 제거하고 파싱한다
    const raw = readFileSync(tsconfigPath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/,(\s*[}\]])/g, '$1')
    const parsed = JSON.parse(raw) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }
    const baseUrl = parsed.compilerOptions?.baseUrl ?? '.'
    const paths = parsed.compilerOptions?.paths ?? {}
    return Object.entries(paths).map(([pattern, targets]) => ({
      prefix: pattern.replace(/\*$/, ''),
      targets: targets.map((target) => posix.join(baseUrl, target.replace(/\*$/, ''))),
    }))
  } catch {
    return []
  }
}

function resolveAliasImport(workspace: string, specifier: string, aliases: TsPathAlias[]): string | undefined {
  for (const alias of aliases) {
    if (!alias.prefix || !specifier.startsWith(alias.prefix)) continue
    const rest = specifier.slice(alias.prefix.length)
    for (const target of alias.targets) {
      const base = posix.normalize(posix.join(target, rest))
      for (const suffix of RESOLVE_SUFFIXES) {
        const candidate = base + suffix
        const absolute = join(workspace, candidate)
        if (existsSync(absolute) && statSync(absolute).isFile()) return candidate
      }
    }
  }
  return undefined
}

function gitGrepFiles(workspace: string, pattern: string, fixed: boolean, limit: number): string[] {
  const args = ['grep', '-l', '-I', ...(fixed ? ['-F'] : ['-E']), '--', pattern]
  try {
    const output = execFileSync('git', args, {
      cwd: workspace,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output.split('\n').filter(Boolean).slice(0, limit)
  } catch {
    // 매칭 없음(exit 1) 또는 git 실행 불가
    return []
  }
}

function extractImports(content: string): string[] {
  const specifiers = new Set<string>()
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content)) !== null) {
      if (match[1]) specifiers.add(match[1])
    }
  }
  return [...specifiers]
}

/** diff에서 새로 추가된 줄에 선언된 심볼 이름 */
function extractDeclaredSymbols(file: DiffFile): string[] {
  const added = file.hunks
    .flatMap((hunk) => hunk.lines)
    .filter((line) => line.type === 'add')
    .map((line) => line.content)
    .join('\n')

  const symbols = new Set<string>()
  DECLARATION_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = DECLARATION_PATTERN.exec(added)) !== null) {
    const name = match[1]
    // 한 글자짜리 지역 변수 같은 흔한 이름은 검색해봐야 노이즈만 늘어난다
    if (name && name.length >= 4) symbols.add(name)
  }
  return [...symbols]
}

/**
 * 변경된 파일 주변의 코드베이스 맥락을 모은다.
 *
 * 1. import 그래프 1홉 — 변경 파일이 의존하는 모듈
 * 2. 역방향 의존 — 변경 파일을 import 하는 호출부 (회귀 위험 판단에 가장 중요)
 * 3. 심볼 사용처 — 새로 추가된 함수/타입 이름이 등장하는 다른 파일
 */
export function findRelatedFiles(workspace: string, diffFiles: DiffFile[], config: BotConfig): RelatedFile[] {
  const changedPaths = new Set(diffFiles.map((file) => file.path))
  const picked = new Map<string, string>() // path -> reason
  const aliases = loadTsPathAliases(workspace)

  const add = (path: string, reason: string): void => {
    if (changedPaths.has(path) || picked.has(path)) return
    if (picked.size >= config.maxRelatedFiles) return
    if (!isUsefulContextFile(path, config)) return
    picked.set(path, reason)
  }

  for (const file of diffFiles) {
    if (file.isBinary || file.status === 'deleted') continue
    if (!CODE_EXTENSIONS.includes(extname(file.path))) continue

    // 1. 이 파일이 import 하는 것들
    const snapshot = readFileSnapshot(workspace, file.path, 200_000)
    if (snapshot) {
      for (const specifier of extractImports(snapshot.content)) {
        const resolved = specifier.startsWith('.')
          ? resolveRelativeImport(workspace, file.path, specifier)
          : resolveAliasImport(workspace, specifier, aliases)
        if (resolved) add(resolved, `${file.path}이(가) import 하는 모듈`)
      }
    }

    // 2. 이 파일을 import 하는 것들
    const moduleName = basename(file.path, extname(file.path))
    if (moduleName && moduleName !== 'index') {
      const pattern = `(from|require\\()[ '"\`][^'"\`]*${escapeRegex(moduleName)}['"\`]`
      for (const importer of gitGrepFiles(workspace, pattern, false, 6)) {
        add(importer, `${file.path}을(를) 사용하는 호출부`)
      }
    }
  }

  // 3. 새로 추가된 심볼이 다른 곳에서 이미 쓰이는지
  if (picked.size < config.maxRelatedFiles) {
    for (const file of diffFiles) {
      for (const symbol of extractDeclaredSymbols(file).slice(0, 8)) {
        for (const user of gitGrepFiles(workspace, symbol, true, 3)) {
          add(user, `${symbol} 심볼이 등장하는 파일`)
        }
        if (picked.size >= config.maxRelatedFiles) break
      }
      if (picked.size >= config.maxRelatedFiles) break
    }
  }

  const related: RelatedFile[] = []
  for (const [path, reason] of picked) {
    const snapshot = readFileSnapshot(workspace, path, Math.floor(config.maxFileChars / 2))
    if (snapshot) related.push({ ...snapshot, reason })
  }

  log.info(`관련 파일 ${related.length}개 수집: ${related.map((file) => file.path).join(', ') || '(없음)'}`)
  return related
}

/**
 * 관련 파일로 끌어올 만한 파일인지 판단한다.
 * 리뷰 제외 패턴(dist, 락파일 등)은 맥락으로도 쓸모가 없다 — 특히 번들 결과물은
 * 소스 전체를 품고 있어 어떤 심볼 검색에도 걸리면서 프롬프트만 잡아먹는다.
 */
export function isUsefulContextFile(path: string, config: BotConfig): boolean {
  if (GENERATED_PATTERNS.some((pattern) => pattern.test(path))) return false
  if (config.exclude.some((pattern) => minimatch(path, pattern, { dot: true }))) return false
  return CONTEXT_EXTENSIONS.has(extname(path))
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
