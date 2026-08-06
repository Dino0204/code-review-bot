import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { truncate } from './budget'
import { log } from '../logger'

export interface RepoMap {
  /** git이 추적 중인 전체 파일 목록 (리포지토리 루트 기준 상대 경로) */
  files: string[]
  /** 프롬프트에 실을 디렉터리 구조 요약 */
  tree: string
  /** package.json / tsconfig 등 빌드·의존성 정보 요약 */
  manifests: string
  /** README, CONTRIBUTING, AGENTS.md 등 규약 문서 발췌 */
  docs: string
}

const DOC_CANDIDATES = [
  'README.md',
  'readme.md',
  'CLAUDE.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'docs/architecture.md',
  'ARCHITECTURE.md',
]

const NOTABLE_ROOT_FILES = [
  'package.json',
  'tsconfig.json',
  'pnpm-workspace.yaml',
  'turbo.json',
  'nx.json',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'requirements.txt',
  'build.gradle',
  'pom.xml',
  'Dockerfile',
  'docker-compose.yml',
  'Makefile',
]

function git(workspace: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd: workspace,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return undefined
  }
}

/**
 * 워크스페이스가 정확히 PR head 커밋 상태인지 확인한다.
 *
 * diff는 GitHub API(PR head 기준)에서 오는데 파일 전체 내용은 디스크에서 읽는다.
 * 둘이 어긋나면 모델이 보는 줄 번호가 diff의 줄 번호와 달라져 코멘트가 엉뚱한 줄에 붙는다.
 * 워크플로가 PR head 대신 기본 브랜치나 merge ref를 체크아웃했을 때 실제로 발생한다.
 */
export function workspaceMatchesSha(workspace: string, expectedSha: string): boolean {
  const head = git(workspace, ['rev-parse', 'HEAD'])?.trim()
  if (!head) return false
  if (head !== expectedSha) {
    log.warn(`워크스페이스 HEAD(${head.slice(0, 8)})가 PR head(${expectedSha.slice(0, 8)})와 다르다`)
    return false
  }
  const dirty = git(workspace, ['status', '--porcelain'])?.trim()
  if (dirty) {
    log.warn('워크스페이스에 커밋되지 않은 변경이 있다 — 파일 내용이 diff와 어긋난다')
    return false
  }
  return true
}

export function listTrackedFiles(workspace: string): string[] {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], {
      cwd: workspace,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    return output.split('\0').filter(Boolean)
  } catch (error) {
    log.warn(`git ls-files 실패 — 리포지토리 맵 없이 진행한다: ${(error as Error).message}`)
    return []
  }
}

/**
 * 디렉터리별 파일 수를 접어서 보여준다.
 * 파일이 수천 개인 리포지토리도 프롬프트에서 수십 줄로 유지된다.
 */
function renderTree(files: string[], maxEntries = 60): string {
  const counts = new Map<string, number>()
  for (const file of files) {
    const dir = dirname(file)
    const key = dir === '.' ? '(root)' : dir.split('/').slice(0, 3).join('/')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const shown = sorted.slice(0, maxEntries)
  const lines = shown.map(([dir, count]) => `${dir}/ (${count} files)`)
  if (sorted.length > shown.length) lines.push(`… 그 밖에 ${sorted.length - shown.length}개 디렉터리`)
  return lines.join('\n')
}

function renderManifests(workspace: string, files: string[]): string {
  const parts: string[] = []

  const packageJsonPath = join(workspace, 'package.json')
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>
      const deps = Object.keys((pkg['dependencies'] as Record<string, string>) ?? {})
      const devDeps = Object.keys((pkg['devDependencies'] as Record<string, string>) ?? {})
      const scripts = Object.keys((pkg['scripts'] as Record<string, string>) ?? {})
      parts.push(
        [
          `package.json — name: ${String(pkg['name'] ?? '-')}, type: ${String(pkg['type'] ?? 'commonjs')}`,
          `scripts: ${scripts.join(', ') || '-'}`,
          `dependencies: ${deps.slice(0, 40).join(', ') || '-'}${deps.length > 40 ? ` 외 ${deps.length - 40}개` : ''}`,
          `devDependencies: ${devDeps.slice(0, 30).join(', ') || '-'}${devDeps.length > 30 ? ` 외 ${devDeps.length - 30}개` : ''}`,
        ].join('\n'),
      )
    } catch {
      // 형식이 깨진 package.json은 조용히 건너뛴다
    }
  }

  const present = NOTABLE_ROOT_FILES.filter((name) => files.includes(name))
  if (present.length) parts.push(`루트 설정 파일: ${present.join(', ')}`)

  return parts.join('\n\n')
}

function renderDocs(workspace: string, maxCharsPerDoc = 4000): string {
  const parts: string[] = []
  for (const candidate of DOC_CANDIDATES) {
    const path = join(workspace, candidate)
    if (!existsSync(path)) continue
    try {
      const content = readFileSync(path, 'utf8').trim()
      if (!content) continue
      parts.push(`--- ${candidate} ---\n${truncate(content, maxCharsPerDoc)}`)
    } catch {
      // 읽기 실패는 무시
    }
    if (parts.length >= 3) break
  }
  return parts.join('\n\n')
}

export function buildRepoMap(workspace: string): RepoMap {
  const files = listTrackedFiles(workspace)
  return {
    files,
    tree: renderTree(files),
    manifests: renderManifests(workspace, files),
    docs: renderDocs(workspace),
  }
}
