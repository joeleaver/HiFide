/**
 * Gemini Explicit Cache Manager
 *
 * Manages explicit caching for Gemini models via the Caching API.
 * Explicit caching guarantees cost savings (90% off on 2.5 models, 75% on 2.0)
 * unlike implicit caching which is probabilistic.
 *
 * Usage:
 * 1. Create a cache with system instructions and tools before the agentic loop
 * 2. Reference the cache ID in all subsequent requests
 * 3. Cache expires after TTL - recreate if needed
 *
 * Reference: https://ai.google.dev/api/caching
 */

const GEMINI_CACHE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

// Default TTL: 1 hour (Gemini's default)
const DEFAULT_TTL_SECONDS = 3600

// Minimum tokens for explicit caching (varies by model, using conservative estimate)
const MIN_TOKENS_FOR_CACHING = 2048

/**
 * Cached content reference returned by the Caching API
 */
export interface GeminiCacheRef {
  /** Full cache name, e.g. "cachedContents/abc123" */
  name: string
  /** When the cache expires (ISO 8601) */
  expireTime: string
  /** Total tokens in the cached content */
  totalTokenCount: number
  /** Model the cache is for */
  model: string
  /** When the cache was created */
  createTime: string
}

/**
 * Options for creating a Gemini cache
 */
export interface CreateCacheOptions {
  /** Gemini API key */
  apiKey: string
  /** Model name (e.g., "gemini-2.5-flash") */
  model: string
  /** System instructions to cache */
  systemInstruction?: string
  /** Tool definitions to cache (in OpenAI format, will be converted) */
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description?: string
      parameters?: any
    }
  }>
  /** Initial content to cache (user messages, function calls, results, etc.) */
  contents?: Array<{
    role: 'user' | 'model'
    parts: Array<{ text?: string; functionCall?: any; functionResponse?: any; thoughtSignature?: string }>
  }>
  /** TTL in seconds (default: 3600 = 1 hour) */
  ttlSeconds?: number
  /** Display name for the cache (optional) */
  displayName?: string
}

/**
 * Recursively strip unsupported fields from JSON schema for Gemini
 * Gemini's Caching API doesn't accept 'additionalProperties' in schemas
 */
function stripUnsupportedSchemaFields(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema

  const cleaned: any = {}
  for (const [key, value] of Object.entries(schema)) {
    // Skip unsupported fields
    if (key === 'additionalProperties') continue

    // Recursively clean nested objects
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        cleaned[key] = value.map(v => stripUnsupportedSchemaFields(v))
      } else {
        cleaned[key] = stripUnsupportedSchemaFields(value)
      }
    } else {
      cleaned[key] = value
    }
  }
  return cleaned
}

/**
 * Convert OpenAI-format tools to Gemini format
 */
function convertToolsToGeminiFormat(tools: CreateCacheOptions['tools']): any[] {
  if (!tools?.length) return []

  return [{
    functionDeclarations: tools.map(t => ({
      name: t.function.name,
      description: t.function.description || '',
      parameters: stripUnsupportedSchemaFields(t.function.parameters) || { type: 'object', properties: {} }
    }))
  }]
}

/**
 * Estimate token count from text (rough estimate: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil((text?.length || 0) / 4)
}

/**
 * Estimate total tokens in cache content
 */
function estimateCacheTokens(options: CreateCacheOptions): number {
  let total = 0

  if (options.systemInstruction) {
    total += estimateTokens(options.systemInstruction)
  }

  if (options.tools?.length) {
    const toolsJson = JSON.stringify(options.tools)
    total += estimateTokens(toolsJson)
  }

  if (options.contents?.length) {
    for (const content of options.contents) {
      for (const part of content.parts) {
        if (part.text) {
          total += estimateTokens(part.text)
        } else if (part.functionCall) {
          total += estimateTokens(JSON.stringify(part.functionCall))
        } else if (part.functionResponse) {
          total += estimateTokens(JSON.stringify(part.functionResponse))
        }
      }
    }
  }

  return total
}

/**
 * Create a new Gemini cache
 *
 * @returns Cache reference with name, expiration, etc.
 * @throws Error if cache creation fails or content is too small
 */
export async function createGeminiCache(options: CreateCacheOptions): Promise<GeminiCacheRef> {
  const {
    apiKey,
    model,
    systemInstruction,
    tools,
    contents,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    displayName
  } = options

  // Estimate tokens to check if we meet minimum
  const estimatedTokens = estimateCacheTokens(options)
  if (estimatedTokens < MIN_TOKENS_FOR_CACHING) {
    throw new Error(
      `Content too small for explicit caching. Estimated ${estimatedTokens} tokens, ` +
      `minimum is ${MIN_TOKENS_FOR_CACHING}. Use implicit caching instead.`
    )
  }

  // Build the cache request body
  const cacheBody: any = {
    model: `models/${model}`,
    ttl: `${ttlSeconds}s`
  }

  if (displayName) {
    cacheBody.displayName = displayName
  }

  // Add system instruction if provided
  if (systemInstruction) {
    cacheBody.systemInstruction = {
      parts: [{ text: systemInstruction }]
    }
  }

  // Add tools if provided
  if (tools?.length) {
    cacheBody.tools = convertToolsToGeminiFormat(tools)
  }

  // Add contents if provided
  if (contents?.length) {
    cacheBody.contents = contents
  }

  // Make the API request
  console.log(`[gemini-cache] Creating cache for model ${model}...`)

  const response = await fetch(`${GEMINI_CACHE_API_BASE}/cachedContents?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(cacheBody)
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`[gemini-cache] Cache creation failed: ${response.status}`, errorText)
    throw new Error(`Failed to create Gemini cache: ${response.status} ${errorText}`)
  }

  console.log(`[gemini-cache] Cache created successfully`)

  const result = await response.json()

  return {
    name: result.name,
    expireTime: result.expireTime,
    totalTokenCount: result.usageMetadata?.totalTokenCount || estimatedTokens,
    model: result.model,
    createTime: result.createTime
  }
}

/**
 * Delete a Gemini cache
 */
export async function deleteGeminiCache(apiKey: string, cacheName: string): Promise<void> {
  const response = await fetch(
    `${GEMINI_CACHE_API_BASE}/${cacheName}?key=${apiKey}`,
    { method: 'DELETE' }
  )

  if (!response.ok && response.status !== 404) {
    const errorText = await response.text()
    throw new Error(`Failed to delete Gemini cache: ${response.status} ${errorText}`)
  }
}

/**
 * Extend a Gemini cache's TTL
 */
export async function extendGeminiCacheTTL(
  apiKey: string,
  cacheName: string,
  ttlSeconds: number
): Promise<GeminiCacheRef> {
  const response = await fetch(
    `${GEMINI_CACHE_API_BASE}/${cacheName}?key=${apiKey}&updateMask=ttl`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ttl: `${ttlSeconds}s`
      })
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to extend Gemini cache TTL: ${response.status} ${errorText}`)
  }

  const result = await response.json()
  return {
    name: result.name,
    expireTime: result.expireTime,
    totalTokenCount: result.usageMetadata?.totalTokenCount || 0,
    model: result.model,
    createTime: result.createTime
  }
}

/**
 * Check if a cache is expired or about to expire
 */
export function isCacheExpired(cacheRef: GeminiCacheRef, bufferSeconds = 60): boolean {
  const expireTime = new Date(cacheRef.expireTime).getTime()
  const now = Date.now()
  return now >= expireTime - (bufferSeconds * 1000)
}

/**
 * Get a Gemini cache by name
 */
export async function getGeminiCache(apiKey: string, cacheName: string): Promise<GeminiCacheRef | null> {
  const response = await fetch(
    `${GEMINI_CACHE_API_BASE}/${cacheName}?key=${apiKey}`,
    { method: 'GET' }
  )

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to get Gemini cache: ${response.status} ${errorText}`)
  }

  const result = await response.json()
  return {
    name: result.name,
    expireTime: result.expireTime,
    totalTokenCount: result.usageMetadata?.totalTokenCount || 0,
    model: result.model,
    createTime: result.createTime
  }
}

/**
 * In-memory cache manager for tracking active caches per session
 */
/**
 * Compute a simple hash of message content for cache invalidation
 * We use this to detect when conversation history has changed
 * Works with Gemini Content[] type (role and parts may be optional)
 */
function computeMessageHash(contents: Array<{ role?: string; parts?: Array<{ text?: string }> }> | undefined): string {
  if (!contents?.length) return 'empty'

  // Create a string from all message content
  const contentStr = contents.map(c =>
    `${c.role || 'unknown'}:${(c.parts || []).map(p => p.text || '').join('|')}`
  ).join('\n')

  // Simple hash function (djb2)
  let hash = 5381
  for (let i = 0; i < contentStr.length; i++) {
    hash = ((hash << 5) + hash) + contentStr.charCodeAt(i)
    hash = hash >>> 0 // Convert to unsigned 32-bit
  }
  return hash.toString(36)
}

class GeminiCacheStore {
  private caches = new Map<string, GeminiCacheRef & { messageHash?: string }>()

  /**
   * Get or create a cache key for a session
   */
  private getCacheKey(sessionId: string, model: string): string {
    return `${sessionId}:${model}`
  }

  /**
   * Store a cache reference with optional message hash
   */
  set(sessionId: string, model: string, cacheRef: GeminiCacheRef, messageHash?: string): void {
    const key = this.getCacheKey(sessionId, model)
    this.caches.set(key, { ...cacheRef, messageHash })
  }

  /**
   * Get a cache reference if it exists, is not expired, and matches message hash
   */
  get(sessionId: string, model: string, messageHash?: string): GeminiCacheRef | null {
    const key = this.getCacheKey(sessionId, model)
    const cacheRef = this.caches.get(key)

    if (!cacheRef) return null

    // Check if expired
    if (isCacheExpired(cacheRef)) {
      this.caches.delete(key)
      return null
    }

    // Check if message hash matches (if provided)
    if (messageHash && cacheRef.messageHash !== messageHash) {
      console.log(`[gemini-cache] Message hash mismatch, cache invalidated. Old: ${cacheRef.messageHash}, New: ${messageHash}`)
      this.caches.delete(key)
      return null
    }

    return cacheRef
  }

  /**
   * Remove a cache reference
   */
  delete(sessionId: string, model: string): void {
    const key = this.getCacheKey(sessionId, model)
    this.caches.delete(key)
  }

  /**
   * Clear all caches for a session
   */
  clearSession(sessionId: string): void {
    for (const key of this.caches.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.caches.delete(key)
      }
    }
  }

  /**
   * Clear all expired caches
   */
  cleanupExpired(): void {
    for (const [key, cacheRef] of this.caches.entries()) {
      if (isCacheExpired(cacheRef)) {
        this.caches.delete(key)
      }
    }
  }
}

// Singleton cache store
export const geminiCacheStore = new GeminiCacheStore()

// Export hash function for use in provider
export { computeMessageHash }

// Cleanup expired caches every 5 minutes
setInterval(() => {
  geminiCacheStore.cleanupExpired()
}, 5 * 60 * 1000)
