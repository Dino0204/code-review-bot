import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commentableLines, parseUnifiedDiff, renderFileDiff, snapToCommentableLine } from '../src/github/diff'

const SAMPLE = `diff --git a/src/math.ts b/src/math.ts
index 1234567..89abcde 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,5 +1,6 @@
 export function add(a: number, b: number): number {
-  return a + b
+  const sum = a + b
+  return sum
 }

 export function sub(a: number, b: number): number {
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const answer = 42
+
diff --git a/assets/logo.png b/assets/logo.png
index 2222222..3333333 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const gone = true
-
`

test('파일 단위로 diff를 분리하고 상태를 판별한다', () => {
  const files = parseUnifiedDiff(SAMPLE)
  assert.equal(files.length, 4)
  assert.deepEqual(
    files.map((file) => [file.path, file.status]),
    [
      ['src/math.ts', 'modified'],
      ['src/new.ts', 'added'],
      ['assets/logo.png', 'modified'],
      ['src/old.ts', 'deleted'],
    ],
  )
  assert.equal(files[2]?.isBinary, true)
})

test('추가/삭제 줄 수와 줄 번호를 계산한다', () => {
  const [math] = parseUnifiedDiff(SAMPLE)
  assert.ok(math)
  assert.equal(math.additions, 2)
  assert.equal(math.deletions, 1)

  const added = math.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.type === 'add')
  assert.deepEqual(
    added.map((line) => [line.newLine, line.content]),
    [
      [2, '  const sum = a + b'],
      [3, '  return sum'],
    ],
  )
})

test('삭제된 줄에는 변경 후 줄 번호가 없다', () => {
  const [math] = parseUnifiedDiff(SAMPLE)
  const deleted = math?.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.type === 'del') ?? []
  assert.equal(deleted.length, 1)
  assert.equal(deleted[0]?.newLine, undefined)
  assert.equal(deleted[0]?.oldLine, 2)
})

test('코멘트 가능한 줄은 컨텍스트 줄까지 포함한다', () => {
  const [math] = parseUnifiedDiff(SAMPLE)
  assert.ok(math)
  const lines = commentableLines(math)
  assert.deepEqual([...lines].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6])
})

test('diff 밖의 줄 번호는 가까운 유효 줄로 스냅하고, 멀면 포기한다', () => {
  const [math] = parseUnifiedDiff(SAMPLE)
  assert.ok(math)
  assert.equal(snapToCommentableLine(math, 3), 3)
  assert.equal(snapToCommentableLine(math, 9), 6)
  assert.equal(snapToCommentableLine(math, 200), undefined)
})

test('프롬프트용 렌더링은 변경 후 줄 번호를 붙인다', () => {
  const [math] = parseUnifiedDiff(SAMPLE)
  assert.ok(math)
  const rendered = renderFileDiff(math)
  assert.match(rendered, /### src\/math\.ts — modified, \+2\/-1/)
  assert.ok(rendered.includes('   2 +   const sum = a + b'), rendered)
  // 삭제된 줄은 번호 자리가 비어 있다
  assert.ok(rendered.includes('     -   return a + b'), rendered)
})

test('공백이 들어간 경로도 +++ 줄에서 복구한다', () => {
  const diff = `diff --git a/src/my file.ts b/src/my file.ts
--- a/src/my file.ts
+++ b/src/my file.ts
@@ -1 +1 @@
-a
+b
`
  const [file] = parseUnifiedDiff(diff)
  assert.equal(file?.path, 'src/my file.ts')
})
