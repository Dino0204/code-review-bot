import { BOT_MENTION, CONFIG_FILES, INSTRUCTION_FILES, loadConfig } from '../config'
import type { BotConfig } from '../config'
import { LlmClient } from '../llm'
import { createGitHubClient } from '../github/client'
import type { GitHubClient } from '../github/client'
import type { GitHubApp } from '../github/app'
import { isBotActor, isTrustedAssociation, parseTrigger, repoRefFrom } from '../github/event'
import type { RawEvent, Trigger } from '../github/event'
import { hasMention, hasReviewTrigger } from '../review/commands'
import { runReview } from '../review/runner'
import type { RunnerDeps } from '../review/runner'
import { answerThread } from '../review/thread'
import type { RepoInstructions } from '../review/prompt'
import { renderError } from '../review/render'
import { log } from '../logger'

export interface HandlerDeps {
  app: GitHubApp
  gsmlApiKey: string
}

export interface AcceptedEvent {
  /** 큐에서 같은 PR의 중복 작업을 걸러내는 키 */
  key: string
  run: () => Promise<void>
}

/** 자동 리뷰를 돌릴 PR 액션. 푸시(synchronize)만 제외한다 — 커밋을 밀 때마다 다시 돌리지 않는다. */
const AUTO_REVIEW_PR_ACTIONS = ['opened', 'reopened', 'ready_for_review']

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
  if (trigger.kind !== 'pull_request' && isBotActor(trigger.author)) {
    log.debug(`${slug}: 봇(${trigger.author})의 코멘트라 무시한다`)
    return undefined
  }

  // 봇을 부르지 않은 코멘트나 관심 없는 PR 액션이면 여기서 끝낸다.
  // 슬래시 접두사는 리포지토리마다 다를 수 있으므로 `/` 로만 거르고 판정은 설정을 읽은 뒤에 한다.
  // 멘션 이름은 고정이라 여기서 끝까지 판정한다 — 남을 부른 코멘트에 API를 쓰지 않는다.
  if (trigger.kind === 'issue_comment') {
    if (!trigger.body.trimStart().startsWith('/')) return undefined
  } else if (trigger.kind === 'review_comment') {
    if (!trigger.body.trimStart().startsWith('/') && !hasMention(trigger.body, BOT_MENTION)) return undefined
  } else if (trigger.kind === 'pull_request') {
    if (trigger.draft || !AUTO_REVIEW_PR_ACTIONS.includes(trigger.action)) return undefined
  }

  return {
    key: queueKey(slug, trigger),
    run: () => execute(deps, repo.owner, repo.repo, installationId, trigger),
  }
}

/**
 * 큐에서 중복을 걸러내는 키.
 *
 * 리뷰는 PR 단위로 묶는다 — 커밋을 연달아 밀면 마지막 상태만 보면 된다.
 * 인라인 쓰레드는 코멘트 단위로 나눈다: 한 PR의 여러 쓰레드에서 동시에 봇을 부를 수 있고,
 * 그중 하나만 답하고 나머지를 버리면 사람이 부른 말이 조용히 사라진다.
 */
function queueKey(slug: string, trigger: Trigger): string {
  return trigger.kind === 'review_comment'
    ? `${slug}#${trigger.pr}@${trigger.commentId}`
    : `${slug}#${trigger.pr}`
}

/** 봇이 이 트리거에 대해 할 일 */
type Intent = { kind: 'review' } | { kind: 'reply'; commentId: number }

/**
 * 이 트리거로 무엇을 할지 정한다. 설정을 읽은 뒤에 판단한다.
 *
 * 인라인 쓰레드에서는 `/review` 명령과 멘션이 둘 다 올 수 있다.
 * 명령을 먼저 본다 — 명시적으로 리뷰를 시킨 사람에게 잡담으로 답하면 안 된다.
 */
function resolveIntent(trigger: Trigger, config: BotConfig): Intent | undefined {
  switch (trigger.kind) {
    case 'pull_request':
      return config.autoReview ? { kind: 'review' } : undefined

    case 'issue_comment':
      return hasReviewTrigger(trigger.body, config.triggerPrefix) ? { kind: 'review' } : undefined

    case 'review_comment': {
      if (hasReviewTrigger(trigger.body, config.triggerPrefix)) return { kind: 'review' }
      if (!config.threadReply) return undefined
      // accept 는 슬래시로 시작하는 코멘트도 통과시킨다 — `/review` 가 아닌 명령이 여기까지 온다
      if (!hasMention(trigger.body, BOT_MENTION)) return undefined
      return { kind: 'reply', commentId: trigger.commentId }
    }
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
  const github = createGitHubClient(token, { owner, repo })

  // 사람이 명시적으로 트리거한 경우에만 권한을 확인한다.
  // 리뷰를 시작하기 전에 한다 — 권한 없는 요청에 API 쿼터를 쓸 이유가 없다.
  const byComment = trigger.kind === 'issue_comment' || trigger.kind === 'review_comment'
  if (byComment) {
    const trusted = isTrustedAssociation(trigger.association) || (await github.hasWriteAccess(trigger.author))
    if (!trusted) {
      log.warn(`${slug}: ${trigger.author}(${trigger.association})에게 쓰기 권한이 없어 명령을 무시한다`)
      return
    }
  }

  const pr = await github.getPullRequest(trigger.pr)
  const config = await loadRepoConfig(github, pr.headSha)

  const intent = resolveIntent(trigger, config)
  if (!intent) {
    log.debug(`${slug}#${trigger.pr}: 봇을 부른 이벤트가 아니다`)
    return
  }

  // 봇이 이벤트를 붙잡았다는 것을 사람이 볼 수 있게 남긴다.
  // 큐가 밀리면 리뷰가 끝나기까지 수십 분이 걸리는데, 그때까지 아무 표시가 없으면
  // 무시당한 줄 알고 같은 요청을 되풀이하게 된다.
  if (byComment) {
    const target = trigger.kind === 'review_comment' ? 'review_comment' : 'issue_comment'
    await github.addReaction(trigger.commentId, 'eyes', target)
  } else {
    // 자동 리뷰에는 사람이 부른 코멘트가 없다 — PR 본문에 단다
    await github.addReaction(trigger.pr, 'eyes', 'issue')
  }

  // 할 일을 정한 뒤에 읽는다 — 무시할 이벤트에 API 쿼터를 쓰지 않는다
  const instructions = await loadRepoInstructions(github, pr.headSha)

  const llm = new LlmClient({
    apiKey: deps.gsmlApiKey,
    baseUrl: config.baseUrl,
    model: config.model,
  })

  try {
    if (intent.kind === 'reply') {
      log.info(`${slug}#${pr.number} 쓰레드 응답 시작 (코멘트 ${intent.commentId})`)
      const outcome = await answerThread(
        { github, llm, config, instructions },
        pr,
        intent.commentId,
      )
      if (outcome.degraded) log.warn('도구 호출을 받지 못해 모델 본문을 그대로 실었다')
      return
    }

    log.info(`${slug}#${pr.number} "${pr.title}" 리뷰 시작`)
    const runnerDeps: RunnerDeps = { github, llm, config, instructions }
    const outcome = await runReview(runnerDeps, pr)
    log.info(`${slug}#${pr.number} 리뷰 완료 — 지적 ${outcome.findings}건`)
  } catch (error) {
    // 실패 사실을 사람이 부른 자리에서 바로 볼 수 있게 남긴다
    const message = error instanceof Error ? error.message : String(error)
    log.error(`${slug}#${pr.number} 실패: ${message}`)
    await reportFailure(github, trigger, intent, message).catch((commentError: unknown) =>
      log.warn(`실패 코멘트 등록 실패: ${String(commentError)}`),
    )
    throw error
  }
}

/** 실패를 알린다. 쓰레드에서 부른 것이면 그 쓰레드에, 아니면 PR 코멘트로 남긴다. */
async function reportFailure(
  github: GitHubClient,
  trigger: Trigger,
  intent: Intent,
  message: string,
): Promise<void> {
  if (intent.kind === 'reply') {
    await github.replyToReviewComment(trigger.pr, intent.commentId, renderError(message, '답변 실패'))
    return
  }
  await github.createIssueComment(trigger.pr, renderError(message))
}

/** 리포지토리의 설정 파일을 API로 읽는다. 후보 중 먼저 발견된 하나만 쓴다. */
async function loadRepoConfig(github: GitHubClient, ref: string): Promise<BotConfig> {
  for (const candidate of CONFIG_FILES) {
    const raw = await github.readFile(candidate, ref)
    if (raw !== undefined) {
      log.info(`설정 파일 로드: ${candidate}`)
      return loadConfig(raw)
    }
  }
  return loadConfig()
}

/**
 * 리포지토리의 코딩 지침 문서를 API로 읽는다. 후보 중 먼저 발견된 하나만 쓴다.
 *
 * 설정 파일과 같은 ref(PR의 head)에서 읽는다 — 지침을 고치는 PR에서 새 지침이
 * 그 PR 리뷰에 바로 반영된다.
 */
async function loadRepoInstructions(github: GitHubClient, ref: string): Promise<RepoInstructions | undefined> {
  for (const candidate of INSTRUCTION_FILES) {
    const raw = await github.readFile(candidate, ref)
    if (raw?.trim()) {
      log.info(`리포지토리 지침 로드: ${candidate} (${raw.length}자)`)
      return { path: candidate, content: raw }
    }
  }
  log.debug(`리포지토리 지침 없음 (${INSTRUCTION_FILES.join(', ')})`)
  return undefined
}
