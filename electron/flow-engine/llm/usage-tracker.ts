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
  private accumulatedUsage: UsageStats = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, reasoningTokens: 0 }
  private usageEmitted = false

  recordProviderUsage(usage: UsageStats, debugLogger?: (details: any) => void): void {
    const prev = this.lastReportedUsage
    const currTotal = usage?.totalTokens ?? ((usage?.inputTokens || 0) + (usage?.outputTokens || 0))
    const prevTotal = prev?.totalTokens ?? ((prev?.inputTokens || 0) + (prev?.outputTokens || 0))
    const isCumulative = !!prev && currTotal >= prevTotal

    let delta = usage
    if (prev && isCumulative) {
      const dTotal = Math.max(0, currTotal - prevTotal)
      const dInput = Math.max(0, (usage.inputTokens || 0) - (prev.inputTokens || 0))
      const dOutput = Math.max(0, dTotal - dInput)
      delta = {
        inputTokens: dInput,
        outputTokens: dOutput,
        totalTokens: Math.max(0, dInput + dOutput),
        cachedTokens: Math.max(0, (usage.cachedTokens || 0) - (prev.cachedTokens || 0)),
        reasoningTokens: Math.max(0, (usage.reasoningTokens || 0) - (prev.reasoningTokens || 0))
      }
    }

    if (debugLogger) {
      try {
        debugLogger({
          mode: isCumulative ? 'cumulative->delta' : 'per-step',
          raw: usage,
          prev,
          delta
        })
      } catch {}
    }

    this.accumulatedUsage = {
      inputTokens: (this.accumulatedUsage.inputTokens || 0) + (delta.inputTokens || 0),
      outputTokens: (this.accumulatedUsage.outputTokens || 0) + (delta.outputTokens || 0),
      totalTokens: (this.accumulatedUsage.totalTokens || 0) + (delta.totalTokens || 0),
      cachedTokens: (this.accumulatedUsage.cachedTokens || 0) + (delta.cachedTokens || 0),
      reasoningTokens: (this.accumulatedUsage.reasoningTokens || 0) + (delta.reasoningTokens || 0)
    }

    this.lastReportedUsage = usage

    if (
      (delta.inputTokens || 0) > 0 ||
      (delta.outputTokens || 0) > 0 ||
      (delta.totalTokens || 0) > 0 ||
      (delta.cachedTokens || 0) > 0 ||
      (delta.reasoningTokens || 0) > 0
    ) {
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

