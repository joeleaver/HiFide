import type { ModelPricing, TokenUsage } from '../../store/types.js'
import { computeTokenCost } from '../settings-cost-utils'

describe('SettingsService.calculateCost', () => {
  it('keeps normal input costs when cached tokens are present', () => {
    const pricing: ModelPricing = {
      inputCostPer1M: 1,
      outputCostPer1M: 2,
      cachedInputCostPer1M: 0.1,
    }

    const usage: TokenUsage = {
      inputTokens: 100,
      cachedTokens: 400,
      outputTokens: 50,
      totalTokens: 150,
    }

    const cost = computeTokenCost(pricing, usage)
    expect(cost).toBeTruthy()
    expect(cost?.normalInputCost).toBeCloseTo(0.0001)
    expect(cost?.cachedInputCost).toBeCloseTo(0.00004)
    expect(cost?.inputCost).toBeCloseTo(0.00014)
  })
})
