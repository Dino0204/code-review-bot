import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG } from '../src/config'
import type { BotConfig } from '../src/config'
import { parseUnifiedDiff } from '../src/github/diff'
import { dedupeKey, prepareFindings, resolveFile, filterFiles } from '../src/review/runner'
import type { ReviewResult } from '../src/review/schema'
import { extractFindingTitle } from '../src/review/render'
import { extractJsonObject } from '../src/llm/client'

const DIFF = `diff --git a/src/user.ts b/src/user.ts
--- a/src/user.ts
+++ b/src/user.ts
@@ -10,4 +10,7 @@ export class UserService {
   async find(id: string) {
-    return this.repo.get(id)
+    const user = await this.repo.get(id)
+    return user.profile.name
   }
 }
`

const files = parseUnifiedDiff(DIFF)

function makeResult(findings: ReviewResult['findings']): ReviewResult {
  return { summary: '요약', verdict: 'comment', findings }
}

function config(overrides: Partial<BotConfig> = {}): BotConfig {
  return { ...DEFAULT_CONFIG, ...overrides }
}

test('유효한 지적은 인라인으로 간다', () => {
  const result = makeResult([
    {
      file: 'src/user.ts',
      line: 12,
      severity: 'major',
      category: 'bug',
      title: 'null 역참조 가능성',
      detail: 'user가 없으면 profile 접근에서 터진다',
      confidence: 0.9,
    },
  ])
  const { inline, overflow } = prepareFindings(result, files, config(), new Set())
  assert.equal(inline.length, 1)
  assert.equal(overflow.length, 0)
  assert.equal(inline[0]?.file, 'src/user.ts')
})

test('심각도와 확신도 임계값 아래는 버린다', () => {
  const result = makeResult([
    { file: 'src/user.ts', line: 12, severity: 'nit', category: 'style', title: '공백', detail: 'x', confidence: 0.9 },
    { file: 'src/user.ts', line: 12, severity: 'major', category: 'bug', title: '불확실', detail: 'x', confidence: 0.2 },
  ])
  const { inline, overflow } = prepareFindings(result, files, config({ minSeverity: 'minor' }), new Set())
  assert.equal(inline.length + overflow.length, 0)
})

test('diff에 없는 파일은 버린다', () => {
  const result = makeResult([
    { file: 'src/nope.ts', line: 3, severity: 'major', category: 'bug', title: 'x', detail: 'y', confidence: 0.9 },
  ])
  const { inline, overflow } = prepareFindings(result, files, config(), new Set())
  assert.equal(inline.length + overflow.length, 0)
})

test('diff 범위 밖 줄은 요약으로 밀린다', () => {
  const result = makeResult([
    { file: 'src/user.ts', line: 999, severity: 'major', category: 'bug', title: 'x', detail: 'y', confidence: 0.9 },
  ])
  const { inline, overflow } = prepareFindings(result, files, config(), new Set())
  assert.equal(inline.length, 0)
  assert.equal(overflow.length, 1)
})

test('이미 게시한 지적은 다시 올리지 않는다', () => {
  const finding = {
    file: 'src/user.ts',
    line: 12,
    severity: 'major' as const,
    category: 'bug',
    title: 'null 역참조 가능성',
    detail: 'x',
    confidence: 0.9,
  }
  const already = new Set([dedupeKey('src/user.ts', 12, 'null 역참조 가능성')])
  const { inline, overflow } = prepareFindings(makeResult([finding]), files, config(), already)
  assert.equal(inline.length + overflow.length, 0)
})

test('인라인 개수 제한을 넘으면 요약으로 밀린다', () => {
  const findings = [11, 12, 13].map((line) => ({
    file: 'src/user.ts',
    line,
    severity: 'major' as const,
    category: 'bug',
    title: `문제 ${line}`,
    detail: 'x',
    confidence: 0.9,
  }))
  const { inline, overflow } = prepareFindings(makeResult(findings), files, config({ maxInlineComments: 2 }), new Set())
  assert.equal(inline.length, 2)
  assert.equal(overflow.length, 1)
})

test('심각도 순으로 정렬된다', () => {
  const findings = (['nit', 'critical', 'minor'] as const).map((severity, index) => ({
    file: 'src/user.ts',
    line: 11 + index,
    severity,
    category: 'bug',
    title: severity,
    detail: 'x',
    confidence: 0.9,
  }))
  const { inline } = prepareFindings(makeResult(findings), files, config({ minSeverity: 'nit' }), new Set())
  assert.deepEqual(
    inline.map((finding) => finding.severity),
    ['critical', 'minor', 'nit'],
  )
})

test('a/ 접두사나 basename만 준 경로도 해석한다', () => {
  assert.equal(resolveFile('a/src/user.ts', files)?.path, 'src/user.ts')
  assert.equal(resolveFile('./src/user.ts', files)?.path, 'src/user.ts')
  assert.equal(resolveFile('user.ts', files)?.path, 'src/user.ts')
  assert.equal(resolveFile('other.ts', files), undefined)
})

test('제외 패턴에 걸린 파일은 리뷰하지 않는다', () => {
  const lockDiff = parseUnifiedDiff(`diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1 +1 @@
-a
+b
`)
  const { selected } = filterFiles(lockDiff, config())
  assert.equal(selected.length, 0)
})

test('봇 코멘트 본문에서 제목을 되뽑는다', () => {
  const body = '<!-- glm-code-review-bot -->\n**🟠 major · bug** — null 역참조 가능성\n\n설명'
  assert.equal(extractFindingTitle(body), 'null 역참조 가능성')
})

test('코드펜스에 싸인 JSON도 추출한다', () => {
  const raw = '설명입니다\n```json\n{"a": {"b": "}"}, "c": 1}\n```\n끝'
  assert.equal(extractJsonObject(raw), '{"a": {"b": "}"}, "c": 1}')
  assert.equal(extractJsonObject('JSON 없음'), undefined)
})
