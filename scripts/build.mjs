import { build } from 'esbuild'

// 도커 실행 단계가 `node_modules` 없이 번들 하나만 들고 가도록
// 의존성을 전부 번들링한다. CJS 전용 의존성이 섞여 있으므로 require 셰임을 주입한다.
const banner = [
  "import { createRequire as __createRequire } from 'node:module'",
  "import { fileURLToPath as __fileURLToPath } from 'node:url'",
  "import { dirname as __dirname_ } from 'node:path'",
  'const require = __createRequire(import.meta.url)',
  'const __filename = __fileURLToPath(import.meta.url)',
  'const __dirname = __dirname_(__filename)',
].join('\n')

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  banner: { js: banner },
}

// server: 웹훅 서버 진입점 (도커 이미지 안에서 실행된다)
const targets = [{ entryPoints: ['src/server/index.ts'], outfile: 'dist/server.mjs' }]

for (const target of targets) {
  await build({ ...common, ...target })
  console.log(`built ${target.outfile}`)
}
