export type RetriableCheck = (err: any) => boolean

export async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function withRetries<T>(fn: () => Promise<T>, options?: { max?: number; baseMs?: number; isRetriable?: RetriableCheck }): Promise<T> {
  const max = options?.max ?? 2
  const baseMs = options?.baseMs ?? 400
  const isRetriable = options?.isRetriable ?? defaultIsRetriable
  let attempt = 0
  let lastErr: any
  while (attempt <= max) {
    try {
      return await fn()
    } catch (err: any) {
      lastErr = err
      attempt += 1
      if (attempt > max || !isRetriable(err)) break
      const backoff = baseMs * Math.pow(2, attempt - 1)
      const jitter = Math.floor(Math.random() * 100)
      await sleep(backoff + jitter)
    }
  }
  throw lastErr
}

export function defaultIsRetriable(err: any): boolean {
  try {
    const status = err?.status ?? err?.response?.status
    if (status === 429) return true
    if (typeof status === 'number' && status >= 500) return true
    const msg = String(err?.message || err || '')
    if (/timeout|econnreset|enotfound|temporar|unavailable|rate/i.test(msg)) return true
  } catch {}
  return false
}

