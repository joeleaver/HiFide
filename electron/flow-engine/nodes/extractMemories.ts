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
  tags: string[]
  importance: 0.25 | 0.5 | 0.75 | 1
}

type ExtractMemoriesResponse = { items: ExtractMemoriesItem[] }

const SYSTEM_INSTRUCTION = `You are a “Workspace Memory Extractor”. Your job is to produce candidate long-term workspace memories from the provided conversation excerpt.

You must follow these rules:

1) Output format (hard requirement)
- Output ONLY valid JSON.
- Do NOT include markdown, explanations, or extra keys.
- Your output must match exactly this shape:

{ "items": [ { "type": "decision|constraint|preference|fact|warning|workflow", "text": "string", "tags": ["string"], "importance": 0.25 } ] }

If there are no high-quality memories, output:
{ "items": [] }

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

7) Importance (choose one)
- 0.25 minor convenience
- 0.5 useful default / common preference
- 0.75 important decision/constraint
- 1.0 critical constraint/security/irreversible decision

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
  // NOTE: llmService.chat includes context.systemInstructions in skipHistory mode;
  // we temporarily override the context system instructions for this call.
  const originalSystem = flow.context.get().systemInstructions
  try {
    flow.context.setSystemInstructions(SYSTEM_INSTRUCTION)

    const responseSchema = {
      name: 'workspace_memory_extraction',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['decision', 'constraint', 'preference', 'fact', 'warning', 'workflow'] },
                text: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                importance: { type: 'number', enum: [0.25, 0.5, 0.75, 1] },
              },
              required: ['type', 'text', 'tags', 'importance'],
              additionalProperties: false,
            },
          },
        },
        required: ['items'],
        additionalProperties: false,
      },
    }

    const llmResult = await llmService.chat({
      message: transcript,
      flowAPI: flow,
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

    const items = Array.isArray(parsed.items) ? parsed.items : []
    const result = await applyMemoryCandidates(
      items
        .filter((it) => enabledTypes[it.type] !== false)
        .map((it) => ({ type: it.type, text: it.text, tags: it.tags, importance: it.importance })),
      { workspaceId: flow.workspaceId }
    )

    return {
      context: flow.context.get(),
      data: dataIn,
      status: 'success' as const,
      metadata: { ...result, provider, model, lookbackPairs },
    }
  } finally {
    flow.context.setSystemInstructions(originalSystem || '')
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
      pairs.push({ user: u.content, assistant: a.content })
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
