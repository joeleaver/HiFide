import { encoding_for_model, get_encoding } from '@dqbd/tiktoken'

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

export function createTokenCounter(provider: string, model: string): TokenCounter {
  let encoder: any | null = null

  const ensureEncoder = () => {
    if (encoder) return encoder
    try {
      encoder = encoding_for_model(model as any)
    } catch {
      try {
        const useO200k = /(^o\d|o\d|gpt-4o|gpt-4\.1)/i.test(model)
        encoder = get_encoding(useO200k ? 'o200k_base' : 'cl100k_base')
      } catch {
        encoder = null
      }
    }
    return encoder
  }

  if (provider !== 'openai') {
    return {
      count: (text: string) => estimateTokensFromFallback(text),
      precise: false,
      dispose: () => {}
    }
  }

  return {
    count: (text: string) => {
      const enc = ensureEncoder()
      if (!enc) {
        return estimateTokensFromFallback(text)
      }
      return enc.encode(text).length
    },
    precise: !!ensureEncoder(),
    dispose: () => {
      if (encoder) {
        try { encoder.free() } catch {}
        encoder = null
      }
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

