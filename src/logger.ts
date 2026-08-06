import * as core from '@actions/core'

const inActions = Boolean(process.env['GITHUB_ACTIONS'])

export const log = {
  debug(message: string): void {
    if (inActions) core.debug(message)
    else if (process.env['REVIEWBOT_DEBUG']) console.debug(`[debug] ${message}`)
  },
  info(message: string): void {
    if (inActions) core.info(message)
    else console.log(message)
  },
  warn(message: string): void {
    if (inActions) core.warning(message)
    else console.warn(`[warn] ${message}`)
  },
  error(message: string): void {
    if (inActions) core.error(message)
    else console.error(`[error] ${message}`)
  },
  /** 시크릿이 로그에 찍히지 않도록 마스킹 등록 */
  mask(secret: string): void {
    if (inActions && secret) core.setSecret(secret)
  },
}
