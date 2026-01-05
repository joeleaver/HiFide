---
id: 91e5cbc1-f72e-4e78-b656-1e3549c48329
title: OpenRouter Provider Implementation
tags: [openrouter, provider, integration, settings, ai-sdk, architecture, sampling, ui, tool-calls, message-history]
files: [electron/providers-ai-sdk/openrouter.ts]
createdAt: 2026-01-03T16:18:39.118Z
updatedAt: 2026-01-05T08:02:12.390Z
---

# OpenRouter Provider Implementation

The OpenRouter provider uses the native OpenAI SDK with a custom baseURL to communicate with OpenRouter's API. It supports all standard LLM features including tool calling, reasoning models, and multi-modal input.

## Key Features

- **Native OpenAI SDK**: Uses `openai` npm package with custom `baseURL`
- **Tool Calling**: Full support for tool calls with name sanitization
- **Reasoning Models**: Automatic detection and streaming of reasoning for Claude 4.x, 3.7/3.5 Sonnet, OpenAI o1/o3, DeepSeek R1, and Fireworks reasoning models
- **Multi-modal**: Supports image input via OpenAI-compatible format
- **Conversation History**: Handles user/assistant alternation with message consolidation

## Architecture

### Message Conversion

The `toOpenAIMessages()` function converts the internal message format to OpenAI's ChatCompletionMessageParam format:

- **User Messages**: Direct mapping of content
- **Assistant Messages**: Consolidated and merged (consecutive assistant messages are combined)
- **Tool Calls**: **Not persisted** - Tool calls from incoming message history are excluded from API requests. Tool calls are only added for the current turn within the agent loop.
- **Tool Results**: **Not persisted** - Tool results from incoming message history are excluded to prevent orphaned results. Tool results are only added for the current turn within the agent loop.
- **Reasoning Details**: Preserved for continuation (Gemini 3, OpenRouter reasoning models)

### Agent Loop

The provider implements an agentic loop that:

1. Makes a streaming request to the model with current conversation history
2. Accumulates text, reasoning, and tool calls from the stream
3. Executes tools and collects results
4. Adds the current turn's assistant message (with tool_calls) and tool results to conversation history
5. Repeats until no more tool calls or max steps reached

## Configuration

- **Base URL**: `https://openrouter.ai/api/v1`
- **Headers**: Includes `HTTP-Referer` and `X-Title` for OpenRouter attribution
- **Tool Choice**: `'auto'` when tools available, `'none'` otherwise
- **Parallel Tool Calls**: Disabled (sequential execution)
- **Reasoning**: Enabled for all models via `reasoning: { enabled: true }`

## Tool Call Handling

### Tool Name Sanitization

Tool names are sanitized to remove non-alphanumeric characters (except `-` and `_`) to ensure compatibility with OpenAI's tool calling API. A name map tracks original → sanitized names.

### Tool Call Lifecycle

1. **Tool Start**: Emits `onToolStart(callId, name, arguments)`
2. **Tool Execution**: Calls `tool.run(arguments, toolMeta)`
3. **Result Processing**: Applies `toModelResult()` if available
4. **Tool End**: Emits `onToolEnd(callId, name, result)`
5. **Error Handling**: Emits `onToolError(callId, name, error)` on failure

### Tool Call Persistence Policy

**Tool calls are NOT persisted to message history from previous turns.** This is a deliberate design decision to:

- Reduce token usage by not sending redundant tool call information
- Prevent potential conflicts with the model's internal state
- Keep the conversation history clean and focused on user/assistant dialogue

Tool calls for the **current turn** are still added to `conversationMessages` within the agent loop, as these are necessary for multi-step agentic workflows. The model receives:
1. User message (or previous assistant message)
2. Assistant response with current turn's tool_calls
3. Tool results for current turn's tool_calls

## Reasoning Model Support

### Detection

Models are automatically detected as reasoning models based on their IDs:
- Claude 4.x: `/claude-4/i`
- Claude 3.7 Sonnet: `/claude-3-7-sonnet/i` or `/claude-3\.7/i`
- Claude 3.5 Sonnet: `/claude-3-5-sonnet/i` or `/claude-3\.5-sonnet/i`
- OpenAI o1/o3: `/o[13](-|$)/i`
- DeepSeek R1: `/deepseek-reasoner/i`
- Fireworks reasoning: `/fireworks-reason/i`

### Streaming

Reasoning is streamed in real-time via the `onReasoning(text)` callback. For models that support it, `reasoning_details` are accumulated for continuation.

### Gemini 3 Thought Signatures

For Gemini 3 models, thought signatures are captured from tool call `extra_content.google.thought_signature` and included in assistant messages for continuation.

## Token Usage

Token usage is reported with these fields:
- `promptTokens`: Input tokens
- `completionTokens`: Output tokens
- `totalTokens`: Sum of prompt + completion
- `cachedTokens`: Cached prompt tokens (from `cache_read_tokens`)
- `reasoningTokens`: Not currently reported (OpenRouter may add this field in the future)

## Related Files

- Provider implementation: `electron/providers-ai-sdk/openrouter.ts`
- Provider interface: `electron/providers/provider.ts`
- LLM service: `electron/flow-engine/llm-service.ts`
- LLM request node: `electron/flow-engine/nodes/llmRequest.ts`
- KB: OpenRouter Provider Integration Plan
- KB: Provider Adapter Contract Specification