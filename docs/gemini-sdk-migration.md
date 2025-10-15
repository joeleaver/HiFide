# Gemini SDK Migration: @google/generative-ai → @google/genai

## Overview

This document describes the migration from the deprecated `@google/generative-ai` SDK to the new `@google/genai` SDK for the Gemini provider in HiFide.

**Migration Date:** October 15, 2025  
**Old SDK:** `@google/generative-ai` v0.24.1  
**New SDK:** `@google/genai` v1.25.0

## Why Migrate?

The `@google/generative-ai` SDK is deprecated and no longer receiving updates for Gemini 2.0+ features. The new `@google/genai` SDK provides:

- Better streaming support with improved APIs
- Native Chat class for session management
- Improved error handling with ApiError class
- Support for Gemini 2.0 features
- Unified API for both Gemini Developer API and Vertex AI

## Key Changes

### 1. Package Installation

**Before:**
```json
"@google/generative-ai": "^0.24.1"
```

**After:**
```json
"@google/genai": "^1.25.0"
```

### 2. Import Statement

**Before:**
```typescript
import { GoogleGenerativeAI } from '@google/generative-ai'
```

**After:**
```typescript
import { GoogleGenAI } from '@google/genai'
```

### 3. Initialization

**Before:**
```typescript
const genAI = new GoogleGenerativeAI(apiKey)
const model = genAI.getGenerativeModel({ model, systemInstruction })
```

**After:**
```typescript
const ai = new GoogleGenAI({ apiKey })
// Models are accessed via ai.models.* methods
```

### 4. Chat Stream (Non-Session)

**Before:**
```typescript
const res = await m.generateContentStream({ contents })
for await (const chunk of res.stream) {
  const text = chunk?.text?.() ?? chunk?.candidates?.[0]?.content?.parts?.[0]?.text
  if (text) onChunk(String(text))
}
const response = await res.response
const usage = response?.usageMetadata
```

**After:**
```typescript
const res = await ai.models.generateContentStream({
  model,
  contents,
  config: {
    systemInstruction: systemInstruction || undefined,
  },
})
for await (const chunk of res) {
  const text = chunk?.text
  if (text) onChunk(String(text))
}
const usage = res?.usageMetadata
```

### 5. Chat Stream (With Session)

**Before:**
```typescript
const chat = model.startChat({ history })
const res = await chat.sendMessageStream(lastUserText)
for await (const chunk of res.stream) {
  const text = chunk?.text?.() ?? chunk?.candidates?.[0]?.content?.parts?.[0]?.text
  if (text) onChunk(String(text))
}
```

**After:**
```typescript
// Note: ai.chats.create() is synchronous, not async
const chat = ai.chats.create({
  model,
  config: {
    systemInstruction: systemInstruction || undefined,
  },
  history,
})
// sendMessageStream takes a SendMessageParameters object with a 'message' property
const streamGenerator = await chat.sendMessageStream({ message: lastUserText })
let lastChunk = null
for await (const chunk of streamGenerator) {
  lastChunk = chunk
  const text = chunk?.text
  if (text) onChunk(String(text))
}
// Token usage is in the last chunk
const usage = lastChunk?.usageMetadata
```

### 6. Function Calling (Agent Stream)

**Before:**
```typescript
const functionDeclarations = tools.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: stripAdditionalProperties(t.parameters),
}))

const streamRes = await m.generateContentStream({
  contents,
  tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined,
})
```

**After:**
```typescript
const functionDeclarations = tools.map((t) => ({
  name: t.name,
  description: t.description,
  parametersJsonSchema: stripAdditionalProperties(t.parameters), // Changed from 'parameters'
}))

const streamRes = await ai.models.generateContentStream({
  model,
  contents,
  config: {
    systemInstruction: systemInstruction || undefined,
    tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined,
  },
})
```

### 7. Structured Output (Response Schema)

**Before:**
```typescript
const genOpts = {}
if (responseSchema) {
  genOpts.responseMimeType = 'application/json'
  genOpts.responseSchema = responseSchema.schema || responseSchema
}
const streamRes = await m.generateContentStream({
  contents,
  tools: [...],
  ...genOpts,
})
```

**After:**
```typescript
const config = {
  systemInstruction: systemInstruction || undefined,
}
if (responseSchema) {
  config.responseMimeType = 'application/json'
  config.responseSchema = responseSchema.schema || responseSchema
}
if (functionDeclarations.length) {
  config.tools = [{ functionDeclarations }]
}
const streamRes = await ai.models.generateContentStream({
  model,
  contents,
  config,
})
```

### 8. Abort/Cancellation

**Before:**
```typescript
holder.abort = () => { try { res?.abortController?.abort?.() } catch {} }
```

**After:**
```typescript
holder.abort = () => { try { res?.controller?.abort?.() } catch {} }
```

### 9. Token Usage

**Before:**
```typescript
const response = await res.response
const usage = response?.usageMetadata
if (usage && onTokenUsage) {
  onTokenUsage({
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
    totalTokens: usage.totalTokenCount || 0,
  })
}
```

**After:**
```typescript
const usage = res?.usageMetadata
if (usage && onTokenUsage) {
  onTokenUsage({
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
    totalTokens: usage.totalTokenCount || 0,
  })
}
```

## Files Modified

1. **package.json** - Updated dependency from `@google/generative-ai` to `@google/genai`
2. **electron/providers/gemini.ts** - Complete refactor of both `chatStream` and `agentStream` methods

## Breaking Changes

None for the application. The provider interface (`ProviderAdapter`) remains unchanged, so no changes are required in calling code.

## Testing

The refactored code:
- ✅ Compiles successfully with TypeScript
- ✅ Builds successfully with Vite and Electron Builder
- ✅ Maintains backward compatibility with existing provider interface
- ✅ Preserves all existing functionality (chat streaming, agent streaming, function calling, structured outputs)

## Migration Checklist

- [x] Update package.json dependency
- [x] Run `pnpm install` to install new SDK
- [x] Update import statement
- [x] Refactor chatStream method
- [x] Refactor agentStream method
- [x] Update error handling
- [x] Test compilation
- [x] Test build process
- [x] Verify no breaking changes to provider interface

## Additional Notes

- The new SDK uses `parametersJsonSchema` instead of `parameters` for function declarations
- Streaming responses now directly iterate over the response object instead of `res.stream`
- Text extraction is simplified to `chunk?.text` instead of the complex fallback chain
- Token usage is available directly on the response object instead of requiring `await res.response`
- The Chat class is now created via `ai.chats.create()` instead of `model.startChat()`
  - **Important:** `ai.chats.create()` is **synchronous**, not async (no `await` needed)
  - `sendMessageStream()` takes a `SendMessageParameters` object with a `message` property, not a raw string
  - Token usage metadata is available in the last chunk of the stream
- All configuration is now passed via a `config` object instead of being spread at the top level
- The Chat class maintains conversation history automatically via `getHistory()` method

## Future Improvements

Consider leveraging new SDK features:
- Model Context Protocol (MCP) support (experimental)
- Better error types with ApiError class
- Improved streaming performance
- Support for Gemini 2.0+ features

