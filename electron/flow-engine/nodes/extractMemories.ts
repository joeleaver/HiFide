/**
 * extractMemories node
 *
 * Uses a configured LLM (provider/model override) to extract durable, workspace-scoped
 * memories from the last N user/assistant message pairs in the current context.
 *
 * This node ALWAYS writes to the workspace memories store (.hifide-public/memories.json)
 * using local deterministic dedupe.
 */

import type { NodeFunction, NodeExecutionPolicy, MainFlowContext } from '../types'
import { normalizeContentToText } from '../llm/payloads'
import { llmService } from '../llm-service'
import { applyMemoryCandidates } from '../../store/utils/memories'


const DEFAULT_PROVIDER = 'openai'
const DEFAULT_MODEL = 'gpt-4o-mini'

export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy,
  description: 'Extracts durable workspace memories via an LLM and writes them to .hifide-public/memories.json.'
}

type ExtractMemoriesItem = {
  type: 'decision' | 'constraint' | 'preference' | 'fact' | 'warning' | 'workflow'
  text: string
  tags: string  // Comma-separated string to avoid deeply nested schemas (Gemini limitation)
  importance: 1 | 2 | 3 | 4  // 1=minor, 2=useful, 3=important, 4=critical (integers for Gemini compatibility)
}

// Response is a flat array to avoid nested schemas (Gemini limitation with items.items)
type ExtractMemoriesResponse = ExtractMemoriesItem[]

const SYSTEM_INSTRUCTION = `You are a “Workspace Memory Extractor”. Your job is to produce candidate long-term workspace memories from the provided conversation excerpt.

You must follow these rules:

1) Output format (hard requirement)
- Output ONLY valid JSON.
- Do NOT include markdown, explanations, or extra keys.
- Your output must match exactly this shape (a JSON array):

[ { "type": "decision|constraint|preference|fact|warning|workflow", "text": "string", "tags": "comma,separated,tags", "importance": 1 } ]

If there are no high-quality memories, output an empty array:
[]

2) What counts as a memory (include only durable info)
Only include an item if it is likely to remain true and useful in this workspace for days/weeks and will help future tasks.

Good memories include:
- Decisions: chosen approaches, file locations as conventions, “we will store X in Y”.
- Constraints: must/never rules, requirements, non-negotiables.
- Preferences: stable style/tooling choices.
- Facts: stable architecture facts.
- Warnings: known pitfalls that repeatedly matter.
- Workflows: repeatable steps.

3) What to exclude (never write these)
Do not output items that are:
- Raw logs, stack traces, tool output dumps, long code blocks.
- Temporary state, debugging narration, or “right now” status.
- Personal data unrelated to the workspace.
- Anything that looks like a secret (tokens, API keys, passwords, private URLs, auth headers). If secrets appear in the input, do not repeat them.

When in doubt, omit it.

4) Deduplication and quality bar
- Avoid restating the same idea in different wording.
- Prefer fewer, higher-quality items.
- Each item must be a standalone, declarative statement.

5) Writing style
- 1–2 sentences max per item.
- Be specific and concrete; remove fluff.
- No meta commentary about the conversation.

6) Tags
- Provide 1–5 lowercase tags.

7) Importance (choose one integer)
- 1 minor convenience
- 2 useful default / common preference
- 3 important decision/constraint
- 4 critical constraint/security/irreversible decision

8) Scope
Assume all memories are workspace-scoped and user-visible.`

export const extractMemoriesNode: NodeFunction = async (flow, context, dataIn, inputs, config) => {
  const executionContext = context ?? (inputs.has('context') ? await inputs.pull('context') : null)
  if (!executionContext) {
    throw new Error('extractMemories node requires a context input')
  }

  const lookbackPairs = Math.max(1, Math.min(10, Number(config.lookbackPairs ?? 1) || 1))
  const provider = (config.provider as string) || DEFAULT_PROVIDER
  const model = (config.model as string) || DEFAULT_MODEL

  const enabledTypes: Record<string, boolean> =
    config.enabledTypes && typeof config.enabledTypes === 'object' ? (config.enabledTypes as Record<string, boolean>) : {}

  const transcript = buildTranscript(executionContext, lookbackPairs)
  if (!transcript) {
    // Nothing to extract; still succeed (pass-through)
    return { context: flow.context.get(), data: dataIn, status: 'success' as const, metadata: { created: 0, updated: 0, skipped: 0 } }
  }

  // Use a stateless call; we don't want extractor messages in conversation history.
  // IMPORTANT: Do not mutate the flow context (system instructions, provider/model, etc.).
  // This node must be isolated aside from writing to the memories store.
  {
    // Simplified schema to avoid Gemini's JSON Schema limitations
    // - Root is an array (not wrapped in { items: [...] })
    // - Tags are a comma-separated string (not an array)
    // - No additionalProperties (Gemini doesn't support it)
    // - Importance uses integer 1-4 instead of decimal enum (Gemini limitations)
    const responseSchema = {
      name: 'workspace_memory_extraction',
      strict: true,
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['decision', 'constraint', 'preference', 'fact', 'warning', 'workflow'] },
            text: { type: 'string' },
            tags: { type: 'string' },
            importance: { type: 'integer', enum: [1, 2, 3, 4] },
          },
          required: ['type', 'text', 'tags', 'importance'],
        },
      },
    }

    const llmResult = await llmService.chat({
      message: transcript,
      flowAPI: flow,
      systemInstructions: SYSTEM_INSTRUCTION,
      responseSchema,
      overrideProvider: provider,
      overrideModel: model,
      skipHistory: true,
      tools: [],
    })

    if (llmResult.error) {
      flow.log.error('extractMemories: LLM error', { error: llmResult.error })
      return { context: flow.context.get(), data: dataIn, status: 'error' as const, error: llmResult.error }
    }

    const parsed = safeParseJson<ExtractMemoriesResponse>(llmResult.text)
    if (!parsed) {
      return { context: flow.context.get(), data: dataIn, status: 'error' as const, error: `extractMemories: invalid JSON response: ${llmResult.text}` }
    }

    // Response is now a flat array (not wrapped in { items: [...] })
    const items = Array.isArray(parsed) ? parsed : []

    // Convert integer importance (1-4) back to decimal (0.25-1.0)
    const importanceMap: Record<number, number> = { 1: 0.25, 2: 0.5, 3: 0.75, 4: 1 }

    const result = await applyMemoryCandidates(
      items
        .filter((it) => enabledTypes[it.type] !== false)
        .map((it) => ({
          type: it.type,
          text: it.text,
          // Parse comma-separated tags string into array
          tags: typeof it.tags === 'string'
            ? it.tags.split(',').map(t => t.trim()).filter(Boolean)
            : (Array.isArray(it.tags) ? it.tags : []),
          importance: importanceMap[it.importance] ?? 0.5
        })),
      { workspaceId: flow.workspaceId }
    )

    return {
      context: flow.context.get(),
      data: dataIn,
      status: 'success' as const,
      metadata: { ...result, provider, model, lookbackPairs },
    }

  }
}

function safeParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function buildTranscript(ctx: MainFlowContext, lookbackPairs: number): string {
  const history = Array.isArray(ctx.messageHistory) ? ctx.messageHistory : []
  if (history.length < 2) return ''

  const pairs: Array<{ user: string; assistant: string }> = []

  // Walk from end, collecting assistant+user pairs.
  let i = history.length - 1
  while (i >= 0 && pairs.length < lookbackPairs) {
    const a = history[i]
    const u = history[i - 1]
    if (a?.role === 'assistant' && u?.role === 'user') {
      pairs.push({
        user: normalizeContentToText(u.content),
        assistant: normalizeContentToText(a.content),
      })
      i -= 2
      continue
    }
    i -= 1
  }

  if (pairs.length === 0) return ''

  const ordered = pairs.reverse()
  const lines: string[] = []
  lines.push('Extract durable workspace memories from the following conversation excerpt.')
  lines.push('')

  for (const pair of ordered) {
    lines.push(`User: ${pair.user}`)
    lines.push(`Assistant: ${pair.assistant}`)
    lines.push('')
  }

  return lines.join('\n')
}
