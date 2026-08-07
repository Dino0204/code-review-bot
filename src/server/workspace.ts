import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { log } from '../logger'

const run = promisify(execFile)

/**
 * 리뷰 대상 커밋 하나만 얕게 받아온다.
 *
 * Actions에서는 actions/checkout이 해주던 일이다. 서버에서는 직접 해야 하는데,
 * 리뷰에 필요한 건 특정 커밋의 파일 트리뿐이라 히스토리는 받지 않는다.
 */
export interface Checkout {
  path: string
  dispose: () => Promise<void>
}

/**
 * 토큰을 argv가 아니라 환경변수로 넘긴다.
 *
 * `git clone https://x-access-token:TOKEN@...` 형태는 프로세스 인자에 토큰이 남아
 * 같은 machine의 다른 사용자가 /proc 으로 들여다볼 수 있다. GIT_CONFIG_* 환경변수는
 * 프로세스별로 격리되므로 그 경로를 쓴다.
 */
function authEnv(token: string): NodeJS.ProcessEnv {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  }
}

export async function checkoutCommit(
  owner: string,
  repo: string,
  sha: string,
  token: string,
): Promise<Checkout> {
  const path = await mkdtemp(join(tmpdir(), 'reviewbot-'))
  const env = authEnv(token)
  const dispose = async (): Promise<void> => {
    await rm(path, { recursive: true, force: true }).catch((error: unknown) => {
      log.warn(`임시 체크아웃 정리 실패(${path}): ${String(error)}`)
    })
  }

  try {
    await run('git', ['init', '--quiet'], { cwd: path, env })
    await run('git', ['remote', 'add', 'origin', `https://github.com/${owner}/${repo}.git`], { cwd: path, env })
    // 커밋 하나만 받는다. GitHub은 sha 지정 fetch를 허용한다.
    await run('git', ['fetch', '--depth', '1', '--quiet', 'origin', sha], { cwd: path, env, maxBuffer: 32 * 1024 * 1024 })
    await run('git', ['checkout', '--quiet', 'FETCH_HEAD'], { cwd: path, env })
    log.debug(`체크아웃 완료: ${owner}/${repo}@${sha.slice(0, 8)} → ${path}`)
    return { path, dispose }
  } catch (error) {
    await dispose()
    throw new Error(`리포지토리 체크아웃 실패(${owner}/${repo}@${sha.slice(0, 8)}): ${(error as Error).message}`)
  }
}
