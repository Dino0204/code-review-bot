import * as core from '@actions/core'
import { loadConfig } from './config'
import { GlmClient } from './glm/client'
import { GitHubClient } from './github/client'
import { isBotActor, isTrustedAssociation, readRepoRef, resolveTrigger } from './github/event'
import type { Trigger } from './github/event'
import { helpText, parseCommand } from './review/commands'
import type { Command } from './review/commands'
import { runAsk, runLearn, runReview, runSummary } from './review/runner'
import type { RunnerDeps } from './review/runner'
import { renderError } from './review/render'
import { log } from './logger'

/** action.yml의 input을 환경변수 형태로 옮겨 config 로더가 한 곳만 보게 한다 */
function applyActionInputs(): void {
  const mapping: Array<[input: string, env: string]> = [
    ['zai-api-key', 'ZAI_API_KEY'],
    ['github-token', 'GITHUB_TOKEN'],
    ['model', 'REVIEWBOT_MODEL'],
    ['fallback-models', 'REVIEWBOT_FALLBACK_MODELS'],
    ['base-url', 'REVIEWBOT_BASE_URL'],
    ['language', 'REVIEWBOT_LANGUAGE'],
    ['trigger-prefix', 'REVIEWBOT_TRIGGER_PREFIX'],
    ['min-severity', 'REVIEWBOT_MIN_SEVERITY'],
    ['auto-review', 'REVIEWBOT_AUTO_REVIEW'],
    ['max-files', 'REVIEWBOT_MAX_FILES'],
    ['instructions', 'REVIEWBOT_INSTRUCTIONS'],
  ]
  for (const [input, env] of mapping) {
    const value = core.getInput(input)
    if (value) process.env[env] = value
  }
}

function resolveCommand(trigger: Trigger, triggerPrefix: string, autoReview: boolean): Command | undefined {
  switch (trigger.kind) {
    case 'issue_comment':
    case 'review_comment':
      return parseCommand(trigger.body, triggerPrefix)
    case 'manual':
      return parseCommand(trigger.body, triggerPrefix) ?? { name: 'review', focus: '', full: false }
    case 'pull_request':
      if (!autoReview) return undefined
      if (trigger.draft) return undefined
      if (!['opened', 'reopened', 'synchronize', 'ready_for_review'].includes(trigger.action)) return undefined
      return { name: 'review', focus: '', full: false }
  }
}

async function main(): Promise<void> {
  applyActionInputs()

  const workspace = process.env['GITHUB_WORKSPACE'] ?? process.cwd()
  const config = loadConfig(workspace)

  const trigger = resolveTrigger()
  if (!trigger) {
    log.info('처리할 트리거가 없다 — 종료')
    return
  }

  if (trigger.kind !== 'pull_request' && isBotActor(trigger.author)) {
    log.info(`봇(${trigger.author})의 코멘트라 무시한다`)
    return
  }

  const command = resolveCommand(trigger, config.triggerPrefix, config.autoReview)
  if (!command) {
    log.info('실행할 명령이 없다 — 종료')
    return
  }

  const token = process.env['GITHUB_TOKEN']
  if (!token) throw new Error('GITHUB_TOKEN이 없다 — 워크플로에서 전달해야 한다')
  const apiKey = process.env['ZAI_API_KEY']
  if (!apiKey) throw new Error('ZAI_API_KEY가 없다 — 리포지토리 시크릿에 등록해야 한다')
  log.mask(apiKey)

  const github = new GitHubClient(token, readRepoRef())

  // 사람이 명시적으로 트리거한 경우에만 권한을 확인한다 (자동 리뷰는 워크플로 권한으로 이미 통제됨).
  // 이벤트에 실려 온 author_association으로 먼저 판단하고, 애매할 때만 API를 부른다.
  if (trigger.kind === 'issue_comment' || trigger.kind === 'review_comment') {
    const trusted = isTrustedAssociation(trigger.association) || (await github.hasWriteAccess(trigger.author))
    if (!trusted) {
      log.warn(`${trigger.author}(${trigger.association})에게 쓰기 권한이 없어 명령을 무시한다`)
      await github.addReaction(trigger.commentId, 'confused')
      return
    }
    await github.addReaction(trigger.commentId, 'eyes')
  }

  const glm = new GlmClient({
    apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    fallbackModels: config.fallbackModels,
  })
  const deps: RunnerDeps = { github, glm, config, workspace }

  if (command.name === 'help') {
    await github.createIssueComment(trigger.pr, helpText(config.triggerPrefix, config.model))
    return
  }

  const pr = await github.getPullRequest(trigger.pr)
  log.info(`대상 PR #${pr.number} "${pr.title}" — 명령: ${command.name}`)

  try {
    switch (command.name) {
      case 'review': {
        const outcome = await runReview(deps, pr, { focus: command.focus, full: command.full })
        core.setOutput('findings', String(outcome.findings))
        core.setOutput('verdict', outcome.verdict)
        log.info(`리뷰 완료 — 지적 ${outcome.findings}건(인라인 ${outcome.inline}건), 판정 ${outcome.verdict}`)
        break
      }
      case 'ask':
        await runAsk(deps, pr, command.question)
        break
      case 'summary':
        await runSummary(deps, pr)
        break
      case 'learn':
        await runLearn(deps, pr)
        break
    }

    core.setOutput('prompt_tokens', String(glm.totalUsage.prompt_tokens))
    core.setOutput('completion_tokens', String(glm.totalUsage.completion_tokens))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error(message)
    // 실패 사실을 PR에서 바로 볼 수 있게 남긴다
    await github
      .createIssueComment(trigger.pr, renderError(message, github.runUrl()))
      .catch((commentError: unknown) => log.warn(`실패 코멘트 등록 실패: ${String(commentError)}`))
    throw error
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  core.setFailed(message)
})
