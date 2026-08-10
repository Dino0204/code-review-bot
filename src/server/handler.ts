import { loadConfig } from '../config'
import { LlmClient } from '../llm'
import { GitHubClient } from '../github/client'
import type { GitHubApp } from '../github/app'
import { isBotActor, isTrustedAssociation, parseTrigger, repoRefFrom } from '../github/event'
import type { RawEvent, Trigger } from '../github/event'
import { helpText, parseCommand } from '../review/commands'
import type { Command } from '../review/commands'
import { runReview } from '../review/runner'
import type { RunnerDeps } from '../review/runner'
import { renderError } from '../review/render'
import { checkoutCommit } from './workspace'
import { log } from '../logger'

export interface HandlerDeps {
  app: GitHubApp
  gsmlApiKey: string
  /** 비어 있으면 App이 설치된 모든 리포지토리를 허용한다 */
  allowedRepos: string[]
}

export interface AcceptedEvent {
  /** 큐에서 같은 PR의 중복 작업을 걸러내는 키 */
  key: string
  run: () => Promise<void>
}

const PR_ACTIONS = ['opened', 'reopened', 'synchronize', 'ready_for_review']

/**
 * 웹훅 이벤트가 리뷰를 돌릴 가치가 있는지 판단한다.
 *
 * 여기서는 API를 부르지 않고 페이로드만 본다 — 웹훅은 10초 안에 응답해야 하고,
 * 관심 없는 이벤트(일반 이슈 코멘트, 라벨 변경 …)가 대부분이기 때문이다.
 * 실제 명령 해석은 리포지토리 설정을 읽은 뒤에 한다.
 */
export function accept(deps: HandlerDeps, eventName: string, payload: RawEvent): AcceptedEvent | undefined {
  const trigger = parseTrigger(eventName, payload)
  if (!trigger) return undefined

  const repo = repoRefFrom(payload)
  if (!repo) return undefined

  const installationId = payload.installation?.id
  if (!installationId) {
    log.warn(`${repo.owner}/${repo.repo}: 웹훅에 installation이 없다 — App 설치 이벤트가 맞는지 확인해야 한다`)
    return undefined
  }

  const slug = `${repo.owner}/${repo.repo}`
  if (deps.allowedRepos.length > 0 && !deps.allowedRepos.includes(slug)) {
    log.warn(`${slug}: 허용 목록에 없어 무시한다`)
    return undefined
  }

  if (trigger.kind !== 'pull_request' && isBotActor(trigger.author)) {
    log.debug(`${slug}: 봇(${trigger.author})의 코멘트라 무시한다`)
    return undefined
  }

  // 슬래시 명령이 아니거나 관심 없는 PR 액션이면 여기서 끝낸다.
  // 접두사를 커스터마이즈한 리포지토리도 있으므로 `/` 로만 거르고, 판정은 설정을 읽은 뒤에 한다.
  if (trigger.kind === 'issue_comment' || trigger.kind === 'review_comment') {
    if (!trigger.body.trimStart().startsWith('/')) return undefined
  } else if (trigger.kind === 'pull_request') {
    if (trigger.draft || !PR_ACTIONS.includes(trigger.action)) return undefined
  }

  return {
    key: `${slug}#${trigger.pr}`,
    run: () => execute(deps, repo.owner, repo.repo, installationId, trigger),
  }
}

function resolveCommand(trigger: Trigger, triggerPrefix: string, autoReview: boolean): Command | undefined {
  switch (trigger.kind) {
    case 'issue_comment':
    case 'review_comment':
      return parseCommand(trigger.body, triggerPrefix)
    case 'pull_request':
      if (!autoReview) return undefined
      return { name: 'review', focus: '' }
  }
}

async function execute(
  deps: HandlerDeps,
  owner: string,
  repo: string,
  installationId: number,
  trigger: Trigger,
): Promise<void> {
  const slug = `${owner}/${repo}`
  const token = await deps.app.installationToken(installationId)
  const github = new GitHubClient(token, { owner, repo })

  // 사람이 명시적으로 트리거한 경우에만 권한을 확인한다.
  // 체크아웃보다 먼저 한다 — 권한 없는 요청에 리포지토리를 받아올 이유가 없다.
  const byComment = trigger.kind === 'issue_comment' || trigger.kind === 'review_comment'
  if (byComment) {
    const trusted = isTrustedAssociation(trigger.association) || (await github.hasWriteAccess(trigger.author))
    if (!trusted) {
      log.warn(`${slug}: ${trigger.author}(${trigger.association})에게 쓰기 권한이 없어 명령을 무시한다`)
      await github.addReaction(trigger.commentId, 'confused')
      return
    }
  }

  const pr = await github.getPullRequest(trigger.pr)
  const checkout = await checkoutCommit(owner, repo, pr.headSha, token)

  try {
    const config = loadConfig(checkout.path)
    const command = resolveCommand(trigger, config.triggerPrefix, config.autoReview)
    if (!command) {
      log.debug(`${slug}#${trigger.pr}: 실행할 명령이 없다`)
      return
    }

    if (byComment) await github.addReaction(trigger.commentId, 'eyes')

    if (command.name === 'help') {
      await github.createIssueComment(trigger.pr, helpText(config.triggerPrefix, config.model))
      return
    }

    log.info(`${slug}#${pr.number} "${pr.title}" — 명령: ${command.name}`)

    const llm = new LlmClient({
      apiKey: deps.gsmlApiKey,
      baseUrl: config.baseUrl,
      model: config.model,
    })
    const runnerDeps: RunnerDeps = { github, llm, config, workspace: checkout.path }

    try {
      const outcome = await runReview(runnerDeps, pr, { focus: command.focus })
      log.info(`${slug}#${pr.number} 리뷰 완료 — 지적 ${outcome.findings}건, 판정 ${outcome.verdict}`)
    } catch (error) {
      // 실패 사실을 PR에서 바로 볼 수 있게 남긴다
      const message = error instanceof Error ? error.message : String(error)
      log.error(`${slug}#${pr.number} 실패: ${message}`)
      await github
        .createIssueComment(trigger.pr, renderError(message))
        .catch((commentError: unknown) => log.warn(`실패 코멘트 등록 실패: ${String(commentError)}`))
      throw error
    }
  } finally {
    await checkout.dispose()
  }
}
