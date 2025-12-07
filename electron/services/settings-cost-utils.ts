import type { ModelPricing, TokenCost, TokenUsage } from '../store/types.js'

export function computeTokenCost(pricing: ModelPricing, usage: TokenUsage): TokenCost {
  const cachedTokens = Math.max(0, usage.cachedTokens || 0)
  const normalInputTokens = Math.max(0, usage.inputTokens || 0)
  const outputTokens = Math.max(0, usage.outputTokens || 0)

  const cachedInputCostPer1M = (pricing as any).cachedInputCostPer1M ?? pricing.inputCostPer1M

  const normalInputCost = (normalInputTokens / 1_000_000) * pricing.inputCostPer1M
  const cachedInputCost = (cachedTokens / 1_000_000) * cachedInputCostPer1M
  const inputCost = normalInputCost + cachedInputCost
  const outputCost = (outputTokens / 1_000_000) * pricing.outputCostPer1M

  let savings = 0
  let savingsPercent = 0
  if (cachedTokens > 0 && cachedInputCostPer1M < pricing.inputCostPer1M) {
    const fullPriceCost = (cachedTokens / 1_000_000) * pricing.inputCostPer1M
    savings = fullPriceCost - cachedInputCost
    const totalWithoutSavings = inputCost + outputCost + savings
    savingsPercent = totalWithoutSavings > 0 ? (savings / totalWithoutSavings) * 100 : 0
  }

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    currency: 'USD',
    cachedInputCost: cachedTokens > 0 ? cachedInputCost : undefined,
    normalInputCost: normalInputTokens > 0 ? normalInputCost : undefined,
    savings: savings > 0 ? savings : undefined,
    savingsPercent: savingsPercent > 0 ? savingsPercent : undefined,
  }
}
