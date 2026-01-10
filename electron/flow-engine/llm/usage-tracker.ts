import { get_encoding, Tiktoken } from '@dqbd/tiktoken'

import { UiPayloadCache } from '../../core/uiPayloadCache'

export interface TokenCounter {
  count: (text: string) => number
  precise: boolean
  dispose: () => void
}

export interface UsageStats {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens?: number
  reasoningTokens?: number
  stepCount?: number  // Number of agentic turns/steps
}

// ============================================================================
// PER-STEP CATEGORY TRACKING
// Tracks token usage by category for each step in an agentic loop.
// This enables accurate reporting of context re-sending overhead.
// ============================================================================

/**
 * Token breakdown by category for a single step.
 * Input categories are what was sent TO the model.
 * Output categories are what the model produced.
 */
export interface StepCategoryBreakdown {
  // Input categories (sent to model)
  systemInstructions: number    // System prompt (re-sent each step)
  toolDefinitions: number       // Tool schemas (re-sent each step)
  userMessages: number          // User message(s) (accumulates in multi-turn)
  assistantMessages: number     // Previous assistant responses (grows each step)
  assistantReasoning: number    // Thinking tokens in history (grows each step)
  toolResults: number           // Tool results from previous steps (grows each step)

  // Output categories (produced by model)
  outputText: number            // Assistant text this step
  outputReasoning: number       // Thinking/reasoning tokens this step
  outputToolCalls: number       // Tool call argument tokens this step
}

/**
 * Complete usage data for a single step in an agentic loop.
 */
export interface StepUsage {
  stepNumber: number
  categories: StepCategoryBreakdown

  // Provider-reported totals for this step
  providerInputTokens: number   // What provider reported as input
  providerOutputTokens: number  // What provider reported as output
  cachedTokens: number          // Tokens served from cache

  // Calculated totals
  inputTotal: number            // Sum of input categories
  outputTotal: number           // Sum of output categories
}

/**
 * Complete breakdown of token usage across all steps in an agentic loop.
 */
export interface AgenticBreakdown {
  steps: StepUsage[]

  // Summary totals
  summary: {
    // Accumulated (summed across all steps - legacy behavior)
    accumulatedInput: number
    accumulatedOutput: number
    accumulatedTotal: number

    // Unique tokens (final step input + all outputs)
    uniqueInput: number         // Last step's input (what you "pay" for)
    uniqueOutput: number        // Sum of all output tokens

    // Total cached tokens
    totalCached: number

    // Re-sent context totals by category
    resent: {
      systemInstructions: number  // (steps-1) * system tokens
      toolDefinitions: number     // (steps-1) * tool def tokens
      userMessages: number        // Sum of re-sent user msg tokens
      assistantMessages: number   // Sum of re-sent assistant tokens
      assistantReasoning: number  // Sum of re-sent reasoning tokens
      toolResults: number         // Sum of re-sent tool result tokens
      total: number               // Total re-sent tokens
    }
  }
}

/**
 * Input for recording a step's category breakdown.
 * Passed to UsageAccumulator.recordStepUsage().
 */
export interface StepCategoryInput {
  stepNumber: number
  categories: StepCategoryBreakdown
  providerInputTokens: number
  providerOutputTokens: number
  cachedTokens: number
}

// ============================================================================
// ENCODER POOL
// Reuses Tiktoken encoders across requests to avoid expensive initialization.
// Uses LRU-style eviction when pool is full.
// ============================================================================

interface PooledEncoder {
  encoder: Tiktoken
  lastUsed: number
  refCount: number
}

const ENCODER_POOL_MAX_SIZE = 10
const encoderPool = new Map<string, PooledEncoder>()

/**
 * Get the encoding key for a provider/model combination.
 * Maps providers and models to their appropriate tokenizer.
 */
function getEncodingKey(provider: string, model: string): string | null {
  // OpenAI and Anthropic use tiktoken-compatible encodings
  if (provider === 'openai' || provider === 'anthropic') {
    // o1, o3, gpt-4o, gpt-4.1 use o200k_base
    const useO200k = /(^o\d|o\d|gpt-4o|gpt-4\.1)/i.test(model)
    return useO200k ? 'o200k_base' : 'cl100k_base'
  }
  return null
}

/**
 * Get or create a pooled encoder for the given key.
 */
function getPooledEncoder(encodingKey: string): Tiktoken | null {
  // Check if already in pool
  const pooled = encoderPool.get(encodingKey)
  if (pooled) {
    pooled.lastUsed = Date.now()
    pooled.refCount++
    return pooled.encoder
  }

  // Create new encoder
  try {
    const encoder = get_encoding(encodingKey as any)

    // Evict oldest entry if pool is full
    if (encoderPool.size >= ENCODER_POOL_MAX_SIZE) {
      let oldestKey: string | null = null
      let oldestTime = Infinity
      for (const [key, entry] of encoderPool.entries()) {
        // Only evict entries with no active references
        if (entry.refCount === 0 && entry.lastUsed < oldestTime) {
          oldestTime = entry.lastUsed
          oldestKey = key
        }
      }
      if (oldestKey) {
        const evicted = encoderPool.get(oldestKey)
        if (evicted) {
          try { evicted.encoder.free() } catch {}
          encoderPool.delete(oldestKey)
        }
      }
    }

    // Add to pool
    encoderPool.set(encodingKey, {
      encoder,
      lastUsed: Date.now(),
      refCount: 1
    })

    return encoder
  } catch {
    return null
  }
}

/**
 * Release a reference to a pooled encoder.
 */
function releasePooledEncoder(encodingKey: string): void {
  const pooled = encoderPool.get(encodingKey)
  if (pooled && pooled.refCount > 0) {
    pooled.refCount--
  }
}

export function createTokenCounter(provider: string, model: string): TokenCounter {
  const encodingKey = getEncodingKey(provider, model)

  // Providers without tiktoken support use character-based estimation
  if (!encodingKey) {
    return {
      count: (text: string) => estimateTokensFromFallback(text),
      precise: false,
      dispose: () => {}
    }
  }

  // Get pooled encoder (lazy initialization on first count call)
  let encoder: Tiktoken | null = null
  let initialized = false

  const ensureEncoder = () => {
    if (!initialized) {
      initialized = true
      encoder = getPooledEncoder(encodingKey)
    }
    return encoder
  }

  return {
    count: (text: string) => {
      const enc = ensureEncoder()
      if (!enc) {
        return estimateTokensFromFallback(text)
      }
      return enc.encode(text).length
    },
    precise: true, // Will be precise if encoder is available
    dispose: () => {
      if (initialized && encodingKey) {
        releasePooledEncoder(encodingKey)
      }
      encoder = null
    }
  }
}

function estimateTokensFromFallback(value: string): number {
  const asciiWeightedLen = String(value || '').replace(/[^\x00-\x7F]/g, 'xx').length
  return Math.ceil(asciiWeightedLen / 4)
}

export class UsageAccumulator {
  private lastReportedUsage: UsageStats | null = null
  private accumulatedUsage: UsageStats = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, reasoningTokens: 0, stepCount: 0 }
  private usageEmitted = false
  private maxStepCount = 0

  // Per-step category tracking
  private stepUsages: StepUsage[] = []

  recordProviderUsage(usage: UsageStats, debugLogger?: (details: any) => void): void {
    // Each provider usage report represents tokens used in that iteration/step.
    // We simply accumulate them directly - no delta calculation needed.
    const inputTokens = Math.max(0, usage?.inputTokens || 0)
    const outputTokens = Math.max(0, usage?.outputTokens || 0)
    const cachedTokens = Math.max(0, usage?.cachedTokens || 0)
    const reasoningTokens = Math.max(0, usage?.reasoningTokens || 0)
    const stepCount = Math.max(0, usage?.stepCount || 0)
    const totalTokens = Math.max(0, usage?.totalTokens ?? (inputTokens + outputTokens + cachedTokens))

    // Track the maximum step count (final step count of the agentic loop)
    if (stepCount > this.maxStepCount) {
      this.maxStepCount = stepCount
    }

    if (debugLogger) {
      try {
        debugLogger({
          mode: 'per-step',
          raw: usage,
          normalized: {
            inputTokens,
            outputTokens,
            cachedTokens,
            reasoningTokens,
            totalTokens
          }
        })
      } catch {}
    }

    // Accumulate tokens directly
    this.accumulatedUsage = {
      inputTokens: (this.accumulatedUsage.inputTokens || 0) + inputTokens,
      outputTokens: (this.accumulatedUsage.outputTokens || 0) + outputTokens,
      totalTokens: (this.accumulatedUsage.totalTokens || 0) + totalTokens,
      cachedTokens: (this.accumulatedUsage.cachedTokens || 0) + cachedTokens,
      reasoningTokens: (this.accumulatedUsage.reasoningTokens || 0) + reasoningTokens,
      stepCount: this.maxStepCount
    }

    this.lastReportedUsage = usage

    if (inputTokens > 0 || outputTokens > 0 || totalTokens > 0 || cachedTokens > 0 || reasoningTokens > 0) {
      this.usageEmitted = true
    }
  }

  /**
   * Record detailed per-step category breakdown.
   * Called by llm-service with category data calculated from conversation state.
   */
  recordStepUsage(input: StepCategoryInput): void {
    const { categories } = input

    // Calculate input/output totals from categories
    const inputTotal =
      categories.systemInstructions +
      categories.toolDefinitions +
      categories.userMessages +
      categories.assistantMessages +
      categories.assistantReasoning +
      categories.toolResults

    const outputTotal =
      categories.outputText +
      categories.outputReasoning +
      categories.outputToolCalls

    const stepUsage: StepUsage = {
      stepNumber: input.stepNumber,
      categories,
      providerInputTokens: input.providerInputTokens,
      providerOutputTokens: input.providerOutputTokens,
      cachedTokens: input.cachedTokens,
      inputTotal,
      outputTotal
    }

    this.stepUsages.push(stepUsage)
  }

  /**
   * Get the complete agentic breakdown with per-step data and re-sent totals.
   */
  getAgenticBreakdown(): AgenticBreakdown {
    const steps = [...this.stepUsages]
    const stepCount = steps.length

    // Handle empty case
    if (stepCount === 0) {
      return {
        steps: [],
        summary: {
          accumulatedInput: this.accumulatedUsage.inputTokens || 0,
          accumulatedOutput: this.accumulatedUsage.outputTokens || 0,
          accumulatedTotal: this.accumulatedUsage.totalTokens || 0,
          uniqueInput: 0,
          uniqueOutput: 0,
          totalCached: this.accumulatedUsage.cachedTokens || 0,
          resent: {
            systemInstructions: 0,
            toolDefinitions: 0,
            userMessages: 0,
            assistantMessages: 0,
            assistantReasoning: 0,
            toolResults: 0,
            total: 0
          }
        }
      }
    }

    const finalStep = steps[stepCount - 1]

    // Calculate accumulated totals from steps
    const accumulatedInput = steps.reduce((sum, s) => sum + s.providerInputTokens, 0)
    const accumulatedOutput = steps.reduce((sum, s) => sum + s.providerOutputTokens, 0)
    const totalCached = steps.reduce((sum, s) => sum + s.cachedTokens, 0)

    // Unique input is the final step's input (what you "pay" for)
    const uniqueInput = finalStep.providerInputTokens
    const uniqueOutput = accumulatedOutput // All outputs are unique

    // Calculate re-sent context by category
    // For constant categories (system, tools): (steps-1) * value
    // For growing categories: sum of all previous values
    const resent = {
      systemInstructions: 0,
      toolDefinitions: 0,
      userMessages: 0,
      assistantMessages: 0,
      assistantReasoning: 0,
      toolResults: 0,
      total: 0
    }

    if (stepCount > 1) {
      // System and tools are re-sent each step after the first
      const firstStep = steps[0]
      resent.systemInstructions = firstStep.categories.systemInstructions * (stepCount - 1)
      resent.toolDefinitions = firstStep.categories.toolDefinitions * (stepCount - 1)

      // For accumulating categories, calculate what was re-sent
      // Step 2 re-sends step 1's user/assistant/results
      // Step 3 re-sends step 1+2's user/assistant/results
      // etc.
      for (let i = 1; i < stepCount; i++) {
        const prevStep = steps[i - 1]
        // Everything that was in previous step's input gets re-sent
        resent.userMessages += prevStep.categories.userMessages
        resent.assistantMessages += prevStep.categories.assistantMessages
        resent.assistantReasoning += prevStep.categories.assistantReasoning
        resent.toolResults += prevStep.categories.toolResults
      }
    }

    resent.total =
      resent.systemInstructions +
      resent.toolDefinitions +
      resent.userMessages +
      resent.assistantMessages +
      resent.assistantReasoning +
      resent.toolResults

    return {
      steps,
      summary: {
        accumulatedInput,
        accumulatedOutput,
        accumulatedTotal: accumulatedInput + accumulatedOutput,
        uniqueInput,
        uniqueOutput,
        totalCached,
        resent
      }
    }
  }

  /**
   * Check if we have per-step category data.
   */
  hasStepData(): boolean {
    return this.stepUsages.length > 0
  }

  hasEmittedUsage(): boolean {
    return this.usageEmitted
  }

  markUsageEmitted(): void {
    this.usageEmitted = true
  }

  emitBestEffortUsage(
    emitUsage: (usage: UsageStats) => void,
    approxInputTokens: number,
    approxOutputTokens: number
  ): void {
    if (this.usageEmitted) {
      return
    }

    if (this.lastReportedUsage) {
      emitUsage({ ...this.lastReportedUsage })
      this.usageEmitted = true
      return
    }

    const usage = {
      inputTokens: approxInputTokens,
      outputTokens: approxOutputTokens,
      totalTokens: approxInputTokens + approxOutputTokens
    }
    emitUsage(usage)
    this.usageEmitted = true
  }

  getAccumulatedTotals(): UsageStats {
    return { ...this.accumulatedUsage }
  }

  getLastReportedUsage(): UsageStats | null {
    return this.lastReportedUsage ? { ...this.lastReportedUsage } : null
  }
}

export interface ToolUsageSnapshot {
  argsTokensOut: number
  resultsTokensIn: number
  argsTokensByTool: Record<string, number>
  resultsTokensByTool: Record<string, number>
  callsByTool: Record<string, number>
}

export class ToolUsageTracker {
  private argsTokensOut = 0
  private resultsTokensIn = 0
  private argsTokensByTool: Record<string, number> = {}
  private resultsTokensByTool: Record<string, number> = {}
  private callsByTool: Record<string, number> = {}

  constructor(
    private readonly tokenCounter: TokenCounter,
    private readonly registerToolResult: (payload: { key: string; data: unknown }) => void
  ) {}

  handleToolStart(event: { callId?: string; name: string; arguments?: any }): void {
    try {
      const key = normalizeToolName(event?.name)
      this.callsByTool[key] = (this.callsByTool[key] || 0) + 1
      if (event && event.arguments != null) {
        const text = typeof event.arguments === 'string' ? event.arguments : JSON.stringify(event.arguments)
        const tokens = this.tokenCounter.count(text)
        this.argsTokensOut += tokens
        this.argsTokensByTool[key] = (this.argsTokensByTool[key] || 0) + tokens
      }
    } catch {}
  }

  handleToolEnd(event: { callId?: string; name: string; result?: any }): void {
    try {
      const key = normalizeToolName(event?.name)
      if (event && (event as any).result != null) {
        const text = typeof (event as any).result === 'string' ? (event as any).result : JSON.stringify((event as any).result)
        const tokens = this.tokenCounter.count(text)
        this.resultsTokensIn += tokens
        this.resultsTokensByTool[key] = (this.resultsTokensByTool[key] || 0) + tokens

        const callId = event?.callId
        const previewKey = (event as any)?.result?.previewKey
        if (callId && previewKey) {
          const cached = UiPayloadCache.peek(previewKey)
          if (typeof cached !== 'undefined') {
            try { this.registerToolResult({ key: callId, data: cached }) } catch {}
          } else {
            setTimeout(() => {
              const later = UiPayloadCache.peek(previewKey)
              if (typeof later !== 'undefined') {
                try { this.registerToolResult({ key: callId, data: later }) } catch {}
              }
            }, 0)
          }
        }
      }
    } catch {}
  }

  getSnapshot(): ToolUsageSnapshot {
    return {
      argsTokensOut: this.argsTokensOut,
      resultsTokensIn: this.resultsTokensIn,
      argsTokensByTool: { ...this.argsTokensByTool },
      resultsTokensByTool: { ...this.resultsTokensByTool },
      callsByTool: { ...this.callsByTool }
    }
  }
}

function normalizeToolName(name?: string): string {
  return String(name || '').trim()
}

