# Specific Code Fixes for Provider Issues

## Fix #1: System Message Format (Line 331-334)

**Current:**
```typescript
if (system && typeof system === 'string') {
  conversationMessages.unshift({ role: 'system', content: system })
}
```

**Fixed:**
```typescript
if (system) {
  if (Array.isArray(system)) {
    // Anthropic format - already blocks
    conversationMessages.unshift({ role: 'system', content: system })
  } else if (typeof system === 'string') {
    // OpenAI/Fireworks format - string
    conversationMessages.unshift({ role: 'system', content: system })
  }
}
```

---

## Fix #2: Async Loop (Line 689-709)

**Current:**
```typescript
runLoop().catch((err: any) => { ... })
return { cancel: () => { ... } }
```

**Fixed:**
```typescript
let loopError: Error | null = null
const loopPromise = runLoop().catch((err: any) => {
  loopError = err
  if (err?.name !== 'AbortError' && !ac.signal.aborted) {
    console.error(`[${id}] Stream error:`, err)
    onStreamError?.(err?.message || String(err))
  }
})

return {
  cancel: () => {
    cancelled = true
    try { ac.abort() } catch {}
  },
  // For callers that need to await completion
  _loopPromise: loopPromise
}
```

---

## Fix #3: Reasoning State Reset (Line 353-354)

**Current:**
```typescript
while (stepCount < AGENT_MAX_STEPS && !cancelled) {
  stepCount++
  // ... reasoning state never reset
```

**Fixed:**
```typescript
while (stepCount < AGENT_MAX_STEPS && !cancelled) {
  stepCount++
  
  // Reset reasoning state for this step
  reasoningState = {
    buffer: '',
    insideTag: false,
    tagName: 'think'
  }
  
  // ... rest of loop
```

---

## Fix #4: Tool Call Deduplication (Line 482-514)

**Current:**
```typescript
const existing = toolCalls.get(idx)
const isNewToolCall = tc.id && existing && existing.id && tc.id !== existing.id
```

**Fixed:**
```typescript
// Track seen IDs to detect new parallel calls
const seenIds = new Set<string>()

// In chunk processing:
if (delta?.tool_calls) {
  for (const tc of delta.tool_calls) {
    if (!tc.id) continue
    
    if (seenIds.has(tc.id)) {
      // Existing call - append arguments
      const idx = Array.from(toolCalls.values())
        .findIndex(t => t.id === tc.id)
      if (idx >= 0) {
        toolCalls.get(idx)!.arguments += tc.function?.arguments || ''
      }
    } else {
      // New call
      seenIds.add(tc.id)
      toolCalls.set(toolCalls.size, {
        id: tc.id,
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || ''
      })
    }
  }
}
```

---

## Fix #5: ResponseSchema (Line 357-364)

**Current:**
```typescript
let requestBody: any = {
  model,
  messages: conversationMessages,
  tools: hasTools ? openaiTools : undefined,
  tool_choice: hasTools ? 'auto' : undefined,
  temperature: typeof temperature === 'number' ? temperature : undefined,
  stream: true
}
```

**Fixed:**
```typescript
let requestBody: any = {
  model,
  messages: conversationMessages,
  tools: hasTools ? openaiTools : undefined,
  tool_choice: hasTools ? 'auto' : undefined,
  temperature: typeof temperature === 'number' ? temperature : undefined,
  stream: true,
  ...(responseSchema ? { response_format: { type: 'json_schema', json_schema: responseSchema } } : {})
}
```

---

## Priority Order

1. **CRITICAL:** Fix #2 (async loop) - causes race conditions
2. **CRITICAL:** Fix #3 (reasoning state) - causes data corruption
3. **HIGH:** Fix #1 (system message) - breaks Anthropic
4. **HIGH:** Fix #4 (tool calls) - breaks multi-tool agents
5. **MEDIUM:** Fix #5 (responseSchema) - breaks structured outputs

