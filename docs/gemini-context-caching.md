# Gemini Context Caching Guide

## Overview

Gemini offers two types of context caching to reduce costs when you repeatedly send the same content:

1. **Implicit Caching** (Automatic) - Enabled by default on Gemini 2.5 models
2. **Explicit Caching** (Manual) - You create and manage cache entries via the API

## How Context Caching Works

When you send a prompt to Gemini, the model processes input tokens. Normally, you pay the full input token rate for every request. With context caching:

- **Cached tokens** are stored and reused across requests at a **reduced rate** (typically 90% cheaper)
- **Storage costs** apply based on how long you keep tokens cached (TTL - Time To Live)
- **Non-cached tokens** in your prompt are still charged at the normal rate

### Cost Breakdown

For Gemini 2.5 Flash (example pricing):
- **Normal input tokens**: $0.075 per 1M tokens
- **Cached input tokens**: $0.01875 per 1M tokens (75% discount)
- **Cache storage**: $1.00 per 1M tokens per hour

**When caching saves money:**
- If you use the same large context (e.g., 100K tokens) more than ~4 times within the TTL period
- The more you reuse cached content, the greater the savings

## Implicit Caching (Automatic)

### What It Is

- **Enabled by default** on all Gemini 2.5 models (2.5 Flash, 2.5 Pro)
- Google automatically caches common prompt prefixes
- **No code changes required** - it just works
- **No guaranteed savings** - caching is opportunistic

### Requirements

- **Minimum tokens**: 
  - Gemini 2.5 Flash: 1,024 tokens
  - Gemini 2.5 Pro: 4,096 tokens
- **Prompt structure**: Put large, reusable content at the beginning of your prompt
- **Timing**: Send similar requests close together in time

### How to Maximize Implicit Cache Hits

1. **Structure prompts consistently**:
   ```
   [Large system instruction or document] ← This gets cached
   [User's specific question]            ← This changes each time
   ```

2. **Use sessions/conversations**: The Chat class automatically maintains history, increasing cache hit likelihood

3. **Batch similar requests**: Send requests with similar prefixes within a short time window

### Detecting Implicit Cache Hits

The `usageMetadata` in responses includes `cachedContentTokenCount`:

```typescript
{
  promptTokenCount: 50000,           // Total input tokens (including cached)
  cachedContentTokenCount: 48000,    // Tokens served from cache (savings!)
  candidatesTokenCount: 500,         // Output tokens
  totalTokenCount: 50500
}
```

**In HiFide**: We automatically detect and report cache hits. Look for:
- Console logs: `[Gemini] Cache hit: 48000 tokens served from cache`
- Session savings tracking (displayed in UI)

## Explicit Caching (Manual)

### What It Is

- **You control** what gets cached and for how long
- **Guaranteed cost savings** when cache is hit
- **More developer work** - you create, manage, and delete cache entries
- Available on most Gemini models (not just 2.5)

### When to Use Explicit Caching

Use explicit caching when:
- You have a **large, stable context** (e.g., documentation, codebase, video file)
- You'll make **many requests** against the same context
- You want **guaranteed savings** and precise control
- The context is **>32K tokens** (minimum for most models)

### How to Use Explicit Caching

#### 1. Create a Cache

```typescript
import { GoogleGenAI } from '@google/genai'

const ai = new GoogleGenAI({ apiKey: 'YOUR_API_KEY' })

// Upload a large file (optional)
const file = await ai.files.upload({ file: './large-document.pdf' })

// Create a cache with the content you want to reuse
const cache = await ai.caches.create({
  model: 'gemini-2.0-flash-001',
  config: {
    displayName: 'my-project-docs',
    systemInstruction: 'You are a helpful assistant for this project.',
    contents: [file],  // Or text content
    ttl: '3600s',      // Cache for 1 hour (default: 1 hour)
  }
})

console.log('Cache created:', cache.name)
// Cache name: "cachedContents/abc123xyz"
```

#### 2. Use the Cache in Requests

```typescript
// Reference the cache in your requests
const response = await ai.models.generateContent({
  model: 'gemini-2.0-flash-001',
  contents: 'What does the document say about authentication?',
  config: {
    cachedContent: cache.name,  // Reference the cache
  }
})

// The cached content is automatically prepended to your prompt
console.log(response.text)
console.log(response.usageMetadata.cachedContentTokenCount) // Tokens from cache
```

#### 3. Manage Cache Lifecycle

```typescript
// List all caches
for await (const cache of ai.caches.list()) {
  console.log(cache.name, cache.displayName, cache.expireTime)
}

// Get cache details
const cache = await ai.caches.get({ name: 'cachedContents/abc123xyz' })

// Update TTL (extend expiration)
await ai.caches.update({
  name: cache.name,
  config: { ttl: '7200s' }  // Extend to 2 hours
})

// Delete cache (stop paying storage costs)
await ai.caches.delete({ name: cache.name })
```

### Explicit Cache Requirements

- **Minimum tokens**: 
  - Gemini 2.5 Flash: 1,024 tokens
  - Gemini 2.5 Pro: 2,048 tokens
  - Other models: 32,768 tokens
- **Maximum tokens**: Same as model's context window
- **TTL**: No minimum or maximum (but you pay storage costs)

## Understanding the Savings

### Example Scenario

You have a 100,000 token document and make 20 requests against it in 1 hour.

**Without caching:**
- Cost: 20 requests × 100,000 tokens × $0.075/1M = $0.15

**With implicit caching (assuming 95% cache hit rate):**
- Cached: 20 requests × 95,000 tokens × $0.01875/1M = $0.036
- Non-cached: 20 requests × 5,000 tokens × $0.075/1M = $0.0075
- **Total: $0.044** (71% savings)

**With explicit caching:**
- Cache storage: 100,000 tokens × 1 hour × $1.00/1M/hour = $0.10
- Cached requests: 20 requests × 100,000 tokens × $0.01875/1M = $0.038
- **Total: $0.138** (8% savings)

**Conclusion**: For this scenario, implicit caching is better! Explicit caching becomes cost-effective when:
- You make **many more requests** (e.g., 100+ requests)
- You keep the cache for a **shorter time** (e.g., 15 minutes)
- You have **very large contexts** (e.g., 500K+ tokens)

## How HiFide Tracks Cache Savings

### Automatic Detection

HiFide automatically detects when Gemini uses cached tokens:

1. **Parse `usageMetadata`**: Extract `cachedContentTokenCount` from responses
2. **Emit savings event**: Notify the UI about cache hits
3. **Display in session**: Show cumulative savings in the session view

### Implementation

In `electron/providers/gemini.ts`:

```typescript
const usage = response.usageMetadata
if (usage && onTokenUsage) {
  onTokenUsage({
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
    totalTokens: usage.totalTokenCount || 0,
  })
  
  // Report cache savings
  const cachedTokens = usage.cachedContentTokenCount || 0
  if (cachedTokens > 0) {
    console.log(`[Gemini] Cache hit: ${cachedTokens} tokens served from cache`)
    ipcMain.emit('llm:savings', null, {
      requestId: sessionId,
      provider: 'gemini',
      model,
      approxTokensAvoided: cachedTokens,
    })
  }
}
```

### Calculating True Cost

To calculate the **true cost** of a request with caching:

```typescript
const normalInputCost = (promptTokenCount - cachedContentTokenCount) * inputPricePerToken
const cachedInputCost = cachedContentTokenCount * cachedPricePerToken
const outputCost = candidatesTokenCount * outputPricePerToken
const totalCost = normalInputCost + cachedInputCost + outputCost

// Savings compared to no caching:
const savingsAmount = cachedContentTokenCount * (inputPricePerToken - cachedPricePerToken)
const savingsPercent = (savingsAmount / (totalCost + savingsAmount)) * 100
```

**Example**:
- Prompt: 50,000 tokens (48,000 cached, 2,000 new)
- Output: 500 tokens
- Prices: $0.075/1M input, $0.01875/1M cached, $0.30/1M output

```
Normal input cost:  2,000 × $0.075/1M  = $0.00015
Cached input cost: 48,000 × $0.01875/1M = $0.0009
Output cost:          500 × $0.30/1M    = $0.00015
Total cost: $0.00120

Without caching: 50,000 × $0.075/1M + 500 × $0.30/1M = $0.00390
Savings: $0.00270 (69% reduction)
```

## Best Practices

### For Implicit Caching (Recommended for Most Use Cases)

1. ✅ **Use Gemini 2.5 models** (Flash or Pro)
2. ✅ **Structure prompts with stable prefixes** (system instructions, documents)
3. ✅ **Use the Chat class** for conversations (automatic history management)
4. ✅ **Keep system instructions consistent** across requests
5. ✅ **Monitor `cachedContentTokenCount`** to verify cache hits

### For Explicit Caching (Advanced Use Cases)

1. ✅ **Cache large, stable content** (>100K tokens)
2. ✅ **Set appropriate TTL** (balance storage cost vs. reuse)
3. ✅ **Delete caches** when done to stop storage charges
4. ✅ **Use descriptive `displayName`** for cache management
5. ✅ **Monitor cache usage** with `ai.caches.list()`

### What NOT to Cache

- ❌ Small contexts (<10K tokens) - overhead not worth it
- ❌ Frequently changing content - cache invalidation overhead
- ❌ One-time requests - no reuse = no savings
- ❌ User-specific data - can't share cache across users

## Troubleshooting

### "No cache hits despite similar prompts"

- Ensure prompts have **identical prefixes** (even whitespace matters)
- Check minimum token requirements (1K-4K depending on model)
- Verify you're using a **Gemini 2.5 model** for implicit caching
- Send requests **close together in time** (within minutes)

### "Explicit cache not reducing costs"

- Verify cache is being referenced: `config: { cachedContent: cache.name }`
- Check `cachedContentTokenCount` in response (should be > 0)
- Ensure cached content meets minimum token requirements
- Calculate break-even point: storage cost vs. request savings

### "Cache expired unexpectedly"

- Default TTL is **1 hour** if not specified
- Update TTL before expiration: `ai.caches.update({ name, config: { ttl: '3600s' } })`
- Monitor `expireTime` field in cache metadata

## References

- [Gemini Context Caching Docs](https://ai.google.dev/gemini-api/docs/caching)
- [Gemini Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Vertex AI Context Caching](https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview)

