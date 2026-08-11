export const log = {
  debug(message: string): void {
    if (process.env['REVIEWBOT_DEBUG']) console.debug(`[debug] ${message}`)
  },
  info(message: string): void {
    console.log(message)
  },
  warn(message: string): void {
    console.warn(`[warn] ${message}`)
  },
  error(message: string): void {
    console.error(`[error] ${message}`)
  },
}
