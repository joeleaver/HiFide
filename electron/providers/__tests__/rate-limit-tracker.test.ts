import { rateLimitTracker } from '../rate-limit-tracker'

const within = (value: number, min: number, max: number) => value >= min && value <= max

describe('RateLimitTracker.updateFromHeaders', () => {
  beforeEach(() => {
    rateLimitTracker.clearLimits('openai')
    rateLimitTracker.clearLimits('anthropic')
    rateLimitTracker.clearLimits('gemini')
  })

  test('parses OpenAI rate limit headers (requests and tokens)', () => {
    const model = 'gpt-4o'
    const now = Date.now()

    rateLimitTracker.updateFromHeaders('openai', model, {
      'x-ratelimit-limit-requests': '10000',
      'x-ratelimit-remaining-requests': '9999',
      'x-ratelimit-reset-requests': '8.64s',
      'x-ratelimit-limit-tokens': '200000',
      'x-ratelimit-remaining-tokens': '199000',
      'x-ratelimit-reset-tokens': '60s'
    })

    const limits = rateLimitTracker.getLimits('openai', model)!

    expect(limits.requestsLimit).toBe(10000)
    expect(limits.requestsRemaining).toBe(9999)
    expect(limits.tokensLimit).toBe(200000)
    expect(limits.tokensRemaining).toBe(199000)

    expect(limits.requestsResetAt).toBeInstanceOf(Date)
    expect(limits.tokensResetAt).toBeInstanceOf(Date)

    const reqMs = (limits.requestsResetAt!.getTime() - now)
    const tokMs = (limits.tokensResetAt!.getTime() - now)

    // Allow some tolerance around 8.64s and 60s
    expect(within(reqMs, 3000, 15000)).toBe(true)
    expect(within(tokMs, 50000, 70000)).toBe(true)
  })

  test('parses Anthropic rate limit headers with ISO reset times', () => {
    const model = 'claude-3-opus-20240229'
    const future30s = new Date(Date.now() + 30_000).toISOString()

    rateLimitTracker.updateFromHeaders('anthropic', model, {
      'anthropic-ratelimit-requests-limit': '50',
      'anthropic-ratelimit-requests-remaining': '49',
      'anthropic-ratelimit-requests-reset': future30s,
      'anthropic-ratelimit-tokens-limit': '50000',
      'anthropic-ratelimit-tokens-remaining': '49000',
      'anthropic-ratelimit-tokens-reset': future30s
    })

    const limits = rateLimitTracker.getLimits('anthropic', model)!
    expect(limits.requestsLimit).toBe(50)
    expect(limits.requestsRemaining).toBe(49)
    expect(limits.tokensLimit).toBe(50000)
    expect(limits.tokensRemaining).toBe(49000)

    expect(limits.requestsResetAt).toBeInstanceOf(Date)
    expect(limits.tokensResetAt).toBeInstanceOf(Date)

    const now = Date.now()
    const reqMs = (limits.requestsResetAt!.getTime() - now)
    const tokMs = (limits.tokensResetAt!.getTime() - now)

    expect(within(reqMs, 10_000, 40_000)).toBe(true)
    expect(within(tokMs, 10_000, 40_000)).toBe(true)
  })
})

describe('RateLimitTracker.checkAndWait', () => {
  beforeEach(() => {
    rateLimitTracker.clearLimits('openai')
    rateLimitTracker.clearLimits('anthropic')
    rateLimitTracker.clearLimits('gemini')
  })

  test('waits when tokens remaining below 10% threshold until tokensResetAt', async () => {
    const model = 'claude-3-haiku-20240307'
    const resetIso = new Date(Date.now() + 2500).toISOString()

    rateLimitTracker.updateFromHeaders('anthropic', model, {
      'anthropic-ratelimit-tokens-limit': '1000',
      'anthropic-ratelimit-tokens-remaining': '50', // 5% remaining
      'anthropic-ratelimit-tokens-reset': resetIso
    })

    const waitMs = await rateLimitTracker.checkAndWait('anthropic', model)
    expect(waitMs).toBeGreaterThan(0)
    expect(waitMs).toBeLessThanOrEqual(3000)
  })

  test('waits based on lastRateLimitError remaining time', async () => {
    const model = 'gpt-4o-mini'

    rateLimitTracker.updateFromError('openai', model, { response: { headers: {} } } as any, {
      waitMs: 1500,
      reason: 'Rate limit exceeded'
    })

    const waitMs = await rateLimitTracker.checkAndWait('openai', model)
    expect(waitMs).toBeGreaterThan(0)
    expect(waitMs).toBeLessThanOrEqual(1500)
  })
})

describe('RateLimitTracker.recordRequest', () => {
  beforeEach(() => {
    rateLimitTracker.clearLimits('openai')
  })

  test('decrements request and token counters when present', () => {
    const model = 'gpt-4o'

    // Initialize counters via headers
    rateLimitTracker.updateFromHeaders('openai', model, {
      'x-ratelimit-remaining-requests': '5',
      'x-ratelimit-limit-tokens': '2000',
      'x-ratelimit-remaining-tokens': '1000'
    })

    rateLimitTracker.recordRequest('openai', model, 200)

    const limits = rateLimitTracker.getLimits('openai', model)!
    expect(limits.requestsRemaining).toBe(4)
    expect(limits.tokensRemaining).toBe(800)
  })
})

