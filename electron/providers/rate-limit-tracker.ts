/**
 * Proactive Rate Limit Tracker
 * 
 * Learns rate limits from provider responses and errors, then enforces
 * them BEFORE making requests to prevent 429 errors.
 * 
 * Features:
 * - Learns limits from response headers (OpenAI, Anthropic)
 * - Learns limits from 429 error messages
 * - Tracks usage per provider/model
 * - Enforces waits before requests
 * - Time-window based reset (per-minute, per-day, etc.)
 */

export interface RateLimitInfo {
  // Request limits
  requestsLimit?: number
  requestsRemaining?: number
  requestsResetAt?: Date

  // Token limits (per-minute)
  tokensLimit?: number
  tokensRemaining?: number
  tokensResetAt?: Date

  // Learned from errors
  lastRateLimitError?: {
    timestamp: Date
    waitMs: number
    reason: string
  }
}

interface ProviderLimits {
  [model: string]: RateLimitInfo
}

interface TrackerState {
  openai: ProviderLimits
  anthropic: ProviderLimits
  gemini: ProviderLimits
}

/**
 * Singleton rate limit tracker
 */
class RateLimitTracker {
  private state: TrackerState = {
    openai: {},
    anthropic: {},
    gemini: {}
  }

  /**
   * Check if we should wait before making a request
   * Returns wait time in ms (0 if no wait needed)
   */
  async checkAndWait(provider: 'openai' | 'anthropic' | 'gemini', model: string): Promise<number> {
    const limits = this.state[provider][model]
    if (!limits) return 0

    const now = new Date()
    let waitMs = 0

    // Check if we hit a rate limit recently
    if (limits.lastRateLimitError) {
      const timeSinceError = now.getTime() - limits.lastRateLimitError.timestamp.getTime()
      const errorWaitMs = limits.lastRateLimitError.waitMs

      // If we're still within the wait period, wait the remaining time
      if (timeSinceError < errorWaitMs) {
        waitMs = Math.max(waitMs, errorWaitMs - timeSinceError)
      }
    }

    // Check request limits
    if (limits.requestsRemaining !== undefined && limits.requestsRemaining <= 0) {
      if (limits.requestsResetAt && limits.requestsResetAt > now) {
        const resetWaitMs = limits.requestsResetAt.getTime() - now.getTime()
        waitMs = Math.max(waitMs, resetWaitMs)
      }
    }

    // Check token limits (conservative: wait if < 10% remaining)
    if (limits.tokensLimit && limits.tokensRemaining !== undefined) {
      const tokensThreshold = limits.tokensLimit * 0.1
      if (limits.tokensRemaining < tokensThreshold) {
        if (limits.tokensResetAt && limits.tokensResetAt > now) {
          const resetWaitMs = limits.tokensResetAt.getTime() - now.getTime()
          waitMs = Math.max(waitMs, resetWaitMs)
        }
      }
    }

    return waitMs
  }

  /**
   * Update limits from successful response headers
   */
  updateFromHeaders(provider: 'openai' | 'anthropic' | 'gemini', model: string, headers: any): void {
    if (!this.state[provider][model]) {
      this.state[provider][model] = {}
    }

    const limits = this.state[provider][model]

    if (provider === 'openai') {
      // OpenAI headers:
      // x-ratelimit-limit-requests: "10000"
      // x-ratelimit-remaining-requests: "9999"
      // x-ratelimit-reset-requests: "8.64s"
      // x-ratelimit-limit-tokens: "200000"
      // x-ratelimit-remaining-tokens: "199000"
      // x-ratelimit-reset-tokens: "60s"

      if (headers['x-ratelimit-limit-requests']) {
        limits.requestsLimit = parseInt(headers['x-ratelimit-limit-requests'])
      }
      if (headers['x-ratelimit-remaining-requests']) {
        limits.requestsRemaining = parseInt(headers['x-ratelimit-remaining-requests'])
      }
      if (headers['x-ratelimit-reset-requests']) {
        const resetSeconds = parseFloat(headers['x-ratelimit-reset-requests'])
        limits.requestsResetAt = new Date(Date.now() + resetSeconds * 1000)
      }

      if (headers['x-ratelimit-limit-tokens']) {
        limits.tokensLimit = parseInt(headers['x-ratelimit-limit-tokens'])
      }
      if (headers['x-ratelimit-remaining-tokens']) {
        limits.tokensRemaining = parseInt(headers['x-ratelimit-remaining-tokens'])
      }
      if (headers['x-ratelimit-reset-tokens']) {
        const resetSeconds = parseFloat(headers['x-ratelimit-reset-tokens'])
        limits.tokensResetAt = new Date(Date.now() + resetSeconds * 1000)
      }
    } else if (provider === 'anthropic') {
      // Anthropic headers:
      // anthropic-ratelimit-requests-limit: "50"
      // anthropic-ratelimit-requests-remaining: "49"
      // anthropic-ratelimit-requests-reset: "2024-01-01T00:01:00Z"
      // anthropic-ratelimit-tokens-limit: "50000"
      // anthropic-ratelimit-tokens-remaining: "49000"
      // anthropic-ratelimit-tokens-reset: "2024-01-01T00:01:00Z"

      if (headers['anthropic-ratelimit-requests-limit']) {
        limits.requestsLimit = parseInt(headers['anthropic-ratelimit-requests-limit'])
      }
      if (headers['anthropic-ratelimit-requests-remaining']) {
        limits.requestsRemaining = parseInt(headers['anthropic-ratelimit-requests-remaining'])
      }
      if (headers['anthropic-ratelimit-requests-reset']) {
        limits.requestsResetAt = new Date(headers['anthropic-ratelimit-requests-reset'])
      }

      if (headers['anthropic-ratelimit-tokens-limit']) {
        limits.tokensLimit = parseInt(headers['anthropic-ratelimit-tokens-limit'])
      }
      if (headers['anthropic-ratelimit-tokens-remaining']) {
        limits.tokensRemaining = parseInt(headers['anthropic-ratelimit-tokens-remaining'])
      }
      if (headers['anthropic-ratelimit-tokens-reset']) {
        limits.tokensResetAt = new Date(headers['anthropic-ratelimit-tokens-reset'])
      }
    } else if (provider === 'gemini') {
      // Gemini doesn't expose detailed headers, but we can track from errors
      // No-op for now
    }

    console.log(`[RateLimitTracker] Updated limits for ${provider}/${model}:`, limits)
  }

  /**
   * Update limits from 429 error
   */
  updateFromError(provider: 'openai' | 'anthropic' | 'gemini', model: string, error: any, parsedInfo: any): void {
    if (!this.state[provider][model]) {
      this.state[provider][model] = {}
    }

    const limits = this.state[provider][model]

    // Store the error info for future proactive waiting
    limits.lastRateLimitError = {
      timestamp: new Date(),
      waitMs: parsedInfo.waitMs || 5000,
      reason: parsedInfo.reason || 'Rate limit exceeded'
    }

    // Learn limits from error message (OpenAI provides detailed info)
    if (parsedInfo.limit) {
      limits.tokensLimit = parsedInfo.limit
    }
    if (parsedInfo.used !== undefined) {
      limits.tokensRemaining = Math.max(0, (parsedInfo.limit || 0) - parsedInfo.used)
    }

    // Check retry-after header
    const retryAfter = error?.response?.headers?.['retry-after']
    if (retryAfter) {
      const retrySeconds = parseFloat(retryAfter)
      limits.requestsResetAt = new Date(Date.now() + retrySeconds * 1000)
    }

    console.log(`[RateLimitTracker] Learned from 429 error for ${provider}/${model}:`, limits)
  }

  /**
   * Decrement request/token counters (optimistic tracking)
   * Called before making a request to track usage even if headers aren't available
   */
  recordRequest(provider: 'openai' | 'anthropic' | 'gemini', model: string, estimatedTokens: number = 1000): void {
    const limits = this.state[provider][model]
    if (!limits) return

    // Decrement request counter
    if (limits.requestsRemaining !== undefined && limits.requestsRemaining > 0) {
      limits.requestsRemaining--
    }

    // Decrement token counter (estimate)
    if (limits.tokensRemaining !== undefined && limits.tokensRemaining > estimatedTokens) {
      limits.tokensRemaining -= estimatedTokens
    }
  }

  /**
   * Get current limits for debugging/UI display
   */
  getLimits(provider: 'openai' | 'anthropic' | 'gemini', model: string): RateLimitInfo | undefined {
    return this.state[provider][model]
  }

  /**
   * Clear limits for a specific provider/model (for testing)
   */
  clearLimits(provider: 'openai' | 'anthropic' | 'gemini', model?: string): void {
    if (model) {
      delete this.state[provider][model]
    } else {
      this.state[provider] = {}
    }
  }

  /**
   * Get all state (for debugging)
   */
  getState(): TrackerState {
    return this.state
  }
}

// Singleton instance
export const rateLimitTracker = new RateLimitTracker()

