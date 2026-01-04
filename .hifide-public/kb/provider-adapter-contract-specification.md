---
id: 52f76b04-617e-4b15-8363-4b8193b73014
title: Provider Adapter Contract Specification
tags: [provider, architecture, contract, specification]
files: [electron/providers/provider.ts, electron/providers-ai-sdk/openrouter.ts, electron/providers-ai-sdk/anthropic.ts, electron/providers-ai-sdk/fireworks.ts, electron/providers-ai-sdk/gemini.ts, electron/providers-ai-sdk/openai.ts]
createdAt: 2026-01-04T22:21:04.834Z
updatedAt: 2026-01-04T22:56:15.382Z
---

# Provider Adapter Contract Specification

This document defines the contract that all LLM provider adapters must implement. A provider adapter is responsible for executing LLM requests against a specific provider API (e.g., OpenAI, Anthropic, OpenRouter, xAI, Fireworks, Gemini).

## Core Interface

All provider adapters must implement the `ProviderAdapter` interface:

```typescript
interface ProviderAdapter {
  execute: (params: {
    apiKey: string;
    model: string;
    messages: Message[];
    system?: string;
    tools?: AgentTool[];
    temperature?: number;
    maxTokens?: number;
    thinkingBudget?: number;
    onChunk?: (chunk: TextChunk | ToolChunk) => void;
    onReasoning?: (text: string) => void;
    onToolStart?: (name: string, args: Record<string, any>) => void;
    onToolEnd?: (name: string, result: any) => void;
    onToolError?: (name: string, error: Error) => void;
  }) => Promise<ProviderResponse>;
  cancel?: () => void;
}
```

## Required Functionality

### 1. System Instructions

**What it is:** The primary system instruction that defines the LLM's role and behavior.

**How it's provided:** Via the `system` parameter in the `execute()` method.

**What providers must do:**
- Pass the system instruction to the LLM API
- Use the appropriate API mechanism (varies by provider)

**Implementation patterns by provider:**

- **Anthropic:** Pass as the first message in the messages array with role `'system'`
- **OpenAI:** Pass as `'system'` role message in the messages array
- **Gemini:** Pass as `system_instruction` parameter in the API call
- **OpenRouter:** Pass as the `system` parameter (via SDK's `instructions` parameter)
- **xAI:** Pass as `'system'` role message in the messages array
- **Fireworks:** Pass as `'system'` role message in the messages array

**Example (OpenRouter):**
```typescript
const input = fromChatMessages(messages);
const result = openrouter.callModel({
  model,
  input,
  instructions: system, // System instruction via SDK's instructions parameter
  tools: sdkTools,
  toolChoice: 'auto'
});
```

### 2. Memories (Long-term Context)

**What it is:** Workspace-specific memories retrieved from vector search and formatted as markdown.

**Where it's handled:** Memories are appended to system instructions at the `llmRequest` node level, NOT at the provider level.

**How it works:**

1. In `electron/flow-engine/nodes/llmRequest.ts`:
   ```typescript
   // Retrieve relevant memories for the current query
   const memories = await retrieveWorkspaceMemoriesForQuery(
     normalizeContentToText(message),
     { workspaceId: flow.workspaceId }
   );
   
   // Append memories to system instructions (local variable, NOT context.systemInstructions)
   let systemInstructions: string | undefined;
   if (memories.length) {
     const lines: string[] = [];
     if (flow.context.systemInstructions) {
       lines.push(flow.context.systemInstructions);
     }
     lines.push('## Relevant workspace memories');
     for (const m of memories) {
       lines.push(`- [${m.type}] ${m.text}`);
     }
     systemInstructions = lines.join('

');
     await markMemoriesUsed(memories.map(m => m.id), { workspaceId: flow.workspaceId });
   } else {
     systemInstructions = flow.context.systemInstructions;
   }
   
   // Pass the combined system+memories to LLM service
   await llmService.generateText(requestId, {
     systemInstructions, // Includes memories if any were found
     messages: [message],
     // ...
   });
   ```

2. The LLM service receives the combined system instructions and passes them to the provider via the `system` parameter.

**What providers must do:**
- **Nothing special.** The provider just receives the final system instructions (which already include memories) and passes them to the LLM API using the patterns described in section 1.
- Do NOT retrieve memories - this is handled at the `llmRequest` node level.

### 3. Tool Call Information Collection

**What it is:** Capturing when tools are invoked, what arguments are passed, and what results are returned.

**What providers must do:**
- Emit events for each tool lifecycle stage:
  - `onToolStart(name, args)` - When a tool call begins
  - `onToolEnd(name, result)` - When a tool call completes successfully
  - `onToolError(name, error)` - When a tool call fails

**Implementation patterns:**

- **AI SDK providers (OpenAI, Anthropic, xAI, Fireworks, Gemini):** Use the tool callbacks from `streamText()`
- **OpenRouter SDK:** Use `getToolStream()` or `getToolCallsStream()` and emit events for each tool call

**Example (OpenRouter):**
```typescript
// Stream tool calls and emit lifecycle events
for await (const toolCall of result.getToolCallsStream()) {
  try {
    onToolStart?.(toolCall.name, toolCall.args);
    const toolResult = await toolCall.run();
    onToolEnd?.(toolCall.name, toolResult);
  } catch (error: any) {
    onToolError?.(toolCall.name, error);
  }
}
```

### 4. Usage Information & Cost Calculation

**What it is:** Tracking token usage (prompt, completion, cached, reasoning) to calculate costs.

**What providers must do:**
- Return a `usage` object in the response with normalized token counts
- Support these token types (all fields are optional but should be provided when available):
  - `promptTokens` - Input tokens (excluding cached)
  - `completionTokens` - Output tokens (excluding reasoning)
  - `totalTokens` - Sum of prompt + completion
  - `cachedTokens` - Cached prompt tokens
  - `reasoningTokens` - Tokens used for reasoning (thinking models only)

**Token normalization:**

Different providers use different field names. Normalize them to the above format:

| Provider | Prompt | Completion | Cached | Reasoning |
|----------|--------|------------|--------|-----------|
| OpenAI | `prompt_tokens` | `completion_tokens` | `prompt_tokens_details.cached_tokens` | N/A |
| Anthropic | `input_tokens` | `output_tokens` | `cache_read_input_tokens` | N/A |
| OpenRouter | `prompt_tokens` | `completion_tokens` | `cache_read_tokens` | `reasoning_tokens` (varies by model) |
| xAI | `prompt_tokens` | `completion_tokens` | N/A | N/A |
| Fireworks | `prompt_tokens` | `completion_tokens` | N/A | N/A |
| Gemini | `promptTokenCount` | `candidatesTokenCount` | `cachedContentTokenCount` | N/A |

**Example (OpenRouter):**
```typescript
const usage = {
  promptTokens: response.usage?.prompt_tokens || 0,
  completionTokens: response.usage?.completion_tokens || 0,
  totalTokens: response.usage?.total_tokens || 0,
  cachedTokens: response.usage?.cache_read_tokens || 0,
  reasoningTokens: response.usage?.reasoning_tokens || 0,
};
```

### 5. Thinking/Reasoning Models

**What it is:** Models that perform internal reasoning before generating output (e.g., Claude 4, OpenAI o1/o3, DeepSeek R1).

**What providers must do:**
- **Detect reasoning models:** Check the model identifier to determine if it's a reasoning model
- **Configure appropriately:** Pass reasoning-specific parameters
- **Stream reasoning output:** Emit reasoning via `onReasoning(text)` callback
- **Return reasoning in response:** Include the reasoning in the `ProviderResponse`

**Reasoning model detection patterns:**

- **Claude 4.x / 3.7 Sonnet / 3.5 Sonnet:** `model.includes('claude-4') || model.includes('claude-3.7') || model.includes('claude-3.5')`
- **OpenAI o1/o3:** `model.includes('o1') || model.includes('o3')`
- **DeepSeek R1:** `model.includes('deepseek-reasoner')`
- **Fireworks reasoning:** `model.includes('fireworks-reason')` or similar

**Implementation patterns by provider:**

- **Anthropic:** Pass `thinkingBudget` as `max_tokens` in a system block
  ```typescript
  system.push({ type: 'text', text: `Please limit your reasoning to ${thinkingBudget} tokens.` });
  ```
- **OpenAI:** Pass `max_completion_tokens` as thinking budget
- **OpenRouter:** Detect reasoning models and stream via `getReasoningStream()`
  ```typescript
  if (isReasoningModel(model)) {
    for await (const chunk of result.getReasoningStream()) {
      onReasoning?.(chunk);
      fullReasoning += chunk;
    }
  }
  ```
- **DeepSeek/Fireworks:** Reasoning appears in the text stream wrapped in special tags (e.g., `<think>`, `fireworks_thinking`)

### 6. Tool & MCP Choices

**What it is:** Controlling whether the LLM can call tools, and which tools are available.

**What providers must do:**
- Pass the appropriate `toolChoice` parameter to the LLM API
- Supported values:
  - `'auto'` (default) - Let the LLM decide when to call tools
  - `'none'` - Prevent tool calls (when no tools are provided)

**Implementation patterns:**

- **AI SDK providers:** Pass `toolChoice: 'auto' | 'none'` to `streamText()`
- **OpenRouter SDK:** Pass `toolChoice: 'auto' | 'none'` to `callModel()`

**Example:**
```typescript
const hasTools = tools && tools.length > 0;
const toolChoice: 'auto' | 'none' = hasTools ? 'auto' : 'none';

const result = openrouter.callModel({
  model,
  input,
  tools: hasTools ? sdkTools : undefined,
  toolChoice
});
```

### 7. Termination Mid-Execution

**What it is:** Allowing the user to cancel an in-progress LLM request.

**What providers must do:**
- Implement a `cancel()` method on the provider adapter
- The `cancel()` method should abort the in-progress request
- Ensure cleanup of resources (abort controllers, streams, etc.)

**Implementation patterns:**

- **AI SDK providers:** Call `abort()` on the abort signal or stream
- **OpenRouter SDK:** Call `cancel()` on the result object

**Example (OpenRouter):**
```typescript
class OpenRouterProvider implements ProviderAdapter {
  private abortController: AbortController | null = null;
  private result: any | null = null;
  
  async execute(params: ProviderParams) {
    this.abortController = new AbortController();
    const result = openrouter.callModel({
      model,
      input,
      signal: this.abortController.signal,
      // ...
    });
    this.result = result;
    // ...
  }
  
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.result) {
      this.result.cancel?.();
    }
  }
}
```

### 8. Multi-modal Input

**What it is:** Supporting images and other media types in addition to text.

**What providers must do:**
- Accept messages with mixed content types (text + images)
- Convert image formats to the provider's expected format

**Message format:**
```typescript
type Message = {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string };
  }>;
};
```

**Implementation patterns:**

- **OpenAI/Anthropic/xAI/Fireworks:** Convert to `content` array with `image_url` type
  ```typescript
  const formattedContent = Array.isArray(msg.content)
    ? msg.content.map(item => {
        if (item.type === 'image_url' && item.image_url) {
          return { type: 'image_url', image_url: item.image_url };
        }
        return item;
      })
    : msg.content;
  ```
- **OpenRouter:** Convert to `image_url` format for SDK
  ```typescript
  const formattedMessages = messages.map(msg => ({
    role: msg.role,
    content: Array.isArray(msg.content)
      ? msg.content.map(item => {
          if (item.type === 'image_url' && item.image_url) {
            return { type: 'image_url', image_url: item.image_url };
          }
          return item;
        })
      : msg.content
  }));
  ```
- **Gemini:** Convert to `inlineData` format

### 9. Conversation History

**What it is:** Maintaining the conversation context across multiple turns.

**What providers must do:**
- Accept an array of messages representing the conversation history
- Format messages correctly for the provider's API

**Message format:**
```typescript
type Message = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string };
  }>;
  toolCallId?: string; // For tool response messages
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, any>;
  }>; // For messages with tool calls
  metadata?: Record<string, any>;
};
```

**Implementation patterns:**

- **AI SDK providers:** Pass messages directly to `streamText()` (AI SDK handles formatting)
- **OpenRouter SDK:** Use `fromChatMessages()` helper to format messages
  ```typescript
  import { fromChatMessages, toChatMessage } from '@openrouter/sdk';
  
  // Format messages for OpenRouter SDK
  const input = messages && messages.length > 0
    ? fromChatMessages(messages)
    : messages?.[0]?.content || '';
  
  const result = openrouter.callModel({
    model,
    input,
    // ...
  });
  
  // Convert response back to message format (optional, for conversation history)
  const assistantMessage = toChatMessage(await result.getResponse());
  ```

**Important:**
- Do NOT assume messages always alternate `user -> assistant -> user -> assistant`
- Tool calls create additional message types: `assistant` (with tool_calls) and `tool` (tool response)
- The LLM service (not the provider) is responsible for building and maintaining the conversation history

### 10. Streaming Architecture

**What it is:** Emitting chunks of the response as they are generated, rather than waiting for the complete response.

**What providers must do:**
- Stream text output via `onChunk(text)` callback
- Stream tool calls via `onToolStart`, `onToolEnd`, `onToolError` callbacks
- Stream reasoning output via `onReasoning(text)` callback (for reasoning models)

**Chunk format:**
```typescript
type TextChunk = {
  type: 'text-delta' | 'text';
  text: string;
};

type ToolChunk = {
  type: 'tool-call' | 'tool-result' | 'tool-error';
  name: string;
  args?: Record<string, any>;
  result?: any;
  error?: Error;
};
```

**Implementation patterns:**

- **AI SDK providers:** Use the `onText()` callback from `streamText()`
  ```typescript
  const result = await streamText({
    model,
    messages,
    onText: (text) => {
      onChunk?.({ type: 'text-delta', text });
    },
    // ...
  });
  ```
- **OpenRouter SDK:** Use `getTextStream()` helper
  ```typescript
  for await (const chunk of result.getTextStream()) {
    onChunk?.({ type: 'text-delta', text: chunk });
  }
  ```

## Error Handling

**What providers must do:**
- Catch and properly handle API errors
- Return error information in the `ProviderResponse`
- Include debug information when available (e.g., HTTP status, error codes)

**Error format:**
```typescript
type ProviderResponse = {
  text: string;
  reasoning?: string;
  usage: NormalizedUsage;
  error?: {
    message: string;
    code?: string;
    statusCode?: number;
    debug?: any;
  };
};
```

## Testing

Provider adapters should be tested with:

1. **Basic text generation:** Verify text is generated and streamed correctly
2. **Tool calls:** Verify tool calls are emitted and lifecycle events work
3. **Multi-modal input:** Verify images are handled correctly
4. **Reasoning models:** Verify reasoning is captured and returned
5. **Usage tracking:** Verify token counts are accurate
6. **Cancellation:** Verify `cancel()` aborts requests correctly
7. **Error handling:** Verify errors are caught and reported

## Provider-Specific Notes

### OpenRouter

- Uses SDK helpers: `fromChatMessages()`, `toChatMessage()`, `getTextStream()`, `getReasoningStream()`, `getToolCallsStream()`, `getToolStream()`, `tool()`
- Passes system instructions via `instructions` parameter (not embedded in messages array)
- Supports `toolChoice: 'auto' | 'none'`
- Detects reasoning models and streams via `getReasoningStream()`
- Multi-modal: converts to `image_url` format for SDK
- Reasoning detection: Claude 4.x, 3.7 Sonnet, 3.5 Sonnet; OpenAI o1/o3 series; DeepSeek/Fireworks reasoning models

### OpenAI

- Uses AI SDK: `streamText()`
- Passes system as first message with role `'system'`
- Tool calls handled via AI SDK's tool callbacks
- Reasoning models: o1/o3 series (pass `max_completion_tokens` for thinking budget)
- Multi-modal: converts to `image_url` format

### Anthropic

- Uses AI SDK: `streamText()`
- Passes system as array of blocks
- Tool calls handled via AI SDK's tool callbacks
- Reasoning models: Claude 4.x, 3.7 Sonnet, 3.5 Sonnet (pass thinking budget in system block)
- Multi-modal: converts to `image` format

### Gemini

- Uses AI SDK: `streamText()`
- Passes system as `system_instruction` parameter
- Tool calls handled via AI SDK's tool callbacks
- Multi-modal: converts to `inlineData` format

### xAI

- Uses AI SDK: `streamText()`
- Passes system as first message with role `'system'`
- Tool calls handled via AI SDK's tool callbacks
- Multi-modal: converts to `image_url` format

### Fireworks

- Uses AI SDK: `streamText()`
- Passes system as first message with role `'system'`
- Tool calls handled via AI SDK's tool callbacks
- Reasoning models: Detect and handle special reasoning tags in output
- Multi-modal: converts to `image_url` format

## Related Files

- Provider implementations: `electron/providers-ai-sdk/`
- Provider interface: `electron/providers/provider.ts`
- LLM service: `electron/flow-engine/llm-service.ts`
- LLM request node: `electron/flow-engine/nodes/llmRequest.ts`
- Memories store: `electron/store/utils/memories.ts`
- Message formatting: `electron/flow-engine/llm/payloads.ts`
