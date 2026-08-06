/**
 * 로컬에서 리뷰를 돌려보는 CLI. GitHub Actions 없이 실제 PR을 대상으로 동작을 확인할 때 쓴다.
 *
 *   npm run review -- --repo owner/name --pr 12            # 리뷰 후 코멘트 게시
 *   npm run review -- --repo owner/name --pr 12 --dry-run  # 게시하지 않고 콘솔 출력만
 *   npm run review -- --repo owner/name --pr 12 --ask "이 변경이 캐시를 깨뜨리나?"
 */
import { loadConfig } from './config'
import { GlmClient } from './glm/client'
import { GitHubClient } from './github/client'
import { gatherContext, runAsk, runLearn, runReview, runSummary, prepareFindings, chunkFiles } from './review/runner'
import { buildReviewMessages } from './review/prompt'
import { reviewResultSchema, SEVERITY_LABEL } from './review/schema'
import type { RunnerDeps } from './review/runner'

interface Args {
  repo?: string
  pr?: number
  ask?: string
  focus?: string
  summary: boolean
  learn: boolean
  full: boolean
  dryRun: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { summary: false, learn: false, full: false, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const next = argv[i + 1]
    switch (flag) {
      case '--repo':
        args.repo = next
        i++
        break
      case '--pr':
        args.pr = Number(next)
        i++
        break
      case '--ask':
        args.ask = next
        i++
        break
      case '--focus':
        args.focus = next
        i++
        break
      case '--summary':
        args.summary = true
        break
      case '--learn':
        args.learn = true
        break
      case '--full':
        args.full = true
        break
      case '--dry-run':
        args.dryRun = true
        break
    }
  }
  return args
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const slug = args.repo ?? process.env['GITHUB_REPOSITORY']
  if (!slug || !args.pr) {
    console.error('사용법: npm run review -- --repo owner/name --pr <번호> [--dry-run] [--focus security] [--ask "질문"]')
    process.exit(1)
  }

  const [owner, repo] = slug.split('/')
  if (!owner || !repo) throw new Error(`--repo 형식이 잘못됐다: ${slug}`)

  const token = process.env['GITHUB_TOKEN']
  const apiKey = process.env['ZAI_API_KEY']
  if (!token) throw new Error('GITHUB_TOKEN 환경변수가 필요하다')
  if (!apiKey) throw new Error('ZAI_API_KEY 환경변수가 필요하다')

  const workspace = process.cwd()
  const config = loadConfig(workspace)
  const github = new GitHubClient(token, { owner, repo })
  const glm = new GlmClient({ apiKey, baseUrl: config.baseUrl, model: config.model })
  const deps: RunnerDeps = { github, glm, config, workspace }

  const pr = await github.getPullRequest(args.pr)
  console.log(`PR #${pr.number} "${pr.title}" (${pr.headRef} → ${pr.baseRef})`)

  if (args.dryRun) {
    const { context } = await gatherContext(deps, pr, { focus: args.focus, full: args.full })
    const chunks = chunkFiles(context.diffFiles, config)
    console.log(`리뷰 대상 ${context.diffFiles.length}개 파일 / 청크 ${chunks.length}개`)
    console.log(`관련 파일: ${context.relatedFiles.map((file) => file.path).join(', ') || '(없음)'}`)

    const messages = buildReviewMessages({ ...context, diffFiles: chunks[0] ?? [] })
    console.log(`프롬프트 길이: ${messages.map((message) => message.content.length).reduce((a, b) => a + b, 0)}자`)

    const result = await glm.chatJson(messages, reviewResultSchema, {
      temperature: config.temperature,
      maxTokens: config.maxOutputTokens,
      thinking: config.thinking,
    })
    const { inline, overflow } = prepareFindings(result, context.diffFiles, config, new Set())

    console.log(`\n--- 요약 ---\n${result.summary}\n`)
    for (const finding of [...inline, ...overflow]) {
      console.log(`${SEVERITY_LABEL[finding.severity]} ${finding.file}:${finding.line} — ${finding.title}`)
      console.log(`   ${finding.detail.replace(/\n/g, '\n   ')}\n`)
    }
    console.log(`토큰: ${glm.totalUsage.prompt_tokens} in / ${glm.totalUsage.completion_tokens} out`)
    return
  }

  if (args.ask) await runAsk(deps, pr, args.ask)
  else if (args.summary) await runSummary(deps, pr)
  else if (args.learn) await runLearn(deps, pr)
  else {
    const outcome = await runReview(deps, pr, { focus: args.focus, full: args.full })
    console.log(`지적 ${outcome.findings}건 / 판정 ${outcome.verdict}`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error)
  process.exit(1)
})
