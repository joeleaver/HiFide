export type RetriableCheck = (err: any) => boolean

export interface RateLimitInfo {
  isRateLimit: boolean
  waitMs: number
  reason?: string
  limit?: number
  used?: number
  requested?: number
}

export interface RetryOptions {
  max?: number
  baseMs?: number
  maxWaitMs?: number  // Max time to wait for rate limits (default: 60s)
  isRetriable?: RetriableCheck
  onRateLimitWait?: (info: { attempt: number; waitMs: number; reason?: string }) => void
}

export async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Parse rate limit error to extract wait time and details
 */
export function parseRateLimitError(err: any): RateLimitInfo {
  // Check for 429 status
  const status = err?.status ?? err?.response?.status
  if (status !== 429) {
    return { isRateLimit: false, waitMs: 0 }
  }

  let waitMs = 0
  let reason: string | undefined
  let limit: number | undefined
  let used: number | undefined
  let requested: number | undefined

  // 1. Check retry-after header (Anthropic, Gemini, sometimes OpenAI)
  const retryAfter = err?.response?.headers?.['retry-after']
  if (retryAfter) {
    waitMs = parseFloat(retryAfter) * 1000
  }

  // 2. Parse error message
  const msg = String(err?.message || err || '')

  // OpenAI: "Please try again in 130ms" or "Please try again in 2.5s"
  const tryAgainMatch = msg.match(/try again in (\d+(?:\.\d+)?)(ms|s)/i)
  if (tryAgainMatch) {
    const value = parseFloat(tryAgainMatch[1])
    const unit = tryAgainMatch[2].toLowerCase()
    waitMs = unit === 's' ? value * 1000 : value
  }

  // OpenAI: Extract limit details
  // "Limit 200000, Used 166894, Requested 33542"
  const limitMatch = msg.match(/Limit (\d+),?\s*Used (\d+),?\s*Requested (\d+)/)
  if (limitMatch) {
    limit = parseInt(limitMatch[1])
    used = parseInt(limitMatch[2])
    requested = parseInt(limitMatch[3])
    reason = `Rate limit: ${used}/${limit} used, requested ${requested}`
  }

  // Anthropic: "rate_limit_error"
  if (msg.includes('rate_limit_error')) {
    reason = reason || 'Anthropic rate limit exceeded'
  }

  // Gemini: "Resource has been exhausted"
  if (msg.includes('exhausted') || msg.includes('quota')) {
    reason = reason || 'Gemini quota exhausted'
  }

  // Fallback: use default wait time if we couldn't parse one
  if (waitMs === 0) {
    waitMs = 5000 // 5 seconds default
    reason = reason || 'Rate limit exceeded'
  }

  return {
    isRateLimit: true,
    waitMs,
    reason,
    limit,
    used,
    requested
  }
}

export async function withRetries<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const max = options?.max ?? 3  // Increased from 2 to 3 for rate limits
  const baseMs = options?.baseMs ?? 400
  const maxWaitMs = options?.maxWaitMs ?? 60000  // Max 60s wait
  const isRetriable = options?.isRetriable ?? defaultIsRetriable
  const onRateLimitWait = options?.onRateLimitWait

  let attempt = 0
  let lastErr: any

  while (attempt <= max) {
    try {
      return await fn()
    } catch (err: any) {
      lastErr = err
      attempt += 1

      if (attempt > max || !isRetriable(err)) break

      // Check if this is a rate limit error
      const rateLimitInfo = parseRateLimitError(err)

      if (rateLimitInfo.isRateLimit) {
        // Use provider-specified wait time (with cap)
        const waitMs = Math.min(rateLimitInfo.waitMs, maxWaitMs)

        console.log(`[Retry] Rate limit detected, waiting ${waitMs}ms before retry ${attempt}/${max}`, {
          reason: rateLimitInfo.reason,
          limit: rateLimitInfo.limit,
          used: rateLimitInfo.used,
          requested: rateLimitInfo.requested
        })

        // Notify callback
        if (onRateLimitWait) {
          onRateLimitWait({
            attempt,
            waitMs,
            reason: rateLimitInfo.reason
          })
        }

        await sleep(waitMs)
      } else {
        // Use exponential backoff for other errors
        const backoff = baseMs * Math.pow(2, attempt - 1)
        const jitter = Math.floor(Math.random() * 100)
        await sleep(backoff + jitter)
      }
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

