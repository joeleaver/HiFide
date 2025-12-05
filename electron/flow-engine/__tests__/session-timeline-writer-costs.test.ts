import { mergeCostBucket, normalizeTokenCostSnapshot, serializeNormalizedCost } from '../session-cost-utils.js'

describe('session timeline writer cost helpers', () => {
  it('normalizes token cost snapshots into canonical fields', () => {
    const normalized = normalizeTokenCostSnapshot({
      inputCost: 0.25,
      outputCost: 0.5,
      totalCost: 0.9,
      currency: 'USD',
      cachedCost: 0.15,
    })

    expect(normalized.inputCost).toBeCloseTo(0.25)
    expect(normalized.outputCost).toBeCloseTo(0.5)
    expect(normalized.cachedCost).toBeCloseTo(0.15)
    expect(normalized.totalCost).toBeCloseTo(0.9)
  })

  it('merges cost buckets and accumulates cached + total cost', () => {
    const first = normalizeTokenCostSnapshot({
      inputCost: 0.2,
      outputCost: 0.1,
      totalCost: 0.35,
      currency: 'USD',
      cachedCost: 0.05,
    })

    const bucket = mergeCostBucket(undefined, first)
    expect(bucket.inputCost).toBeCloseTo(0.2)
    expect(bucket.outputCost).toBeCloseTo(0.1)
    expect((bucket as any).cachedCost).toBeCloseTo(0.05)
    expect(bucket.totalCost).toBeCloseTo(0.35)

    const second = normalizeTokenCostSnapshot({
      inputCost: 0.1,
      outputCost: 0.2,
      totalCost: 0.35,
      currency: 'USD',
      cachedCost: 0,
    })

    const merged = mergeCostBucket(bucket, second)
    expect(merged.inputCost).toBeCloseTo(0.3)
    expect(merged.outputCost).toBeCloseTo(0.3)
    expect((merged as any).cachedCost).toBeCloseTo(0.05)
    expect(merged.totalCost).toBeCloseTo(0.7)
  })

  it('serializes normalized cost snapshots for request logs', () => {
    const normalized = normalizeTokenCostSnapshot({
      inputCost: 0.4,
      outputCost: 0.2,
      totalCost: 0.7,
      cachedCost: 0.1,
      currency: 'USD',
    })

    const serialized = serializeNormalizedCost(normalized)
    expect(serialized.inputCost).toBeCloseTo(0.4)
    expect(serialized.outputCost).toBeCloseTo(0.2)
    expect(serialized.totalCost).toBeCloseTo(0.7)
    expect((serialized as any).cachedCost).toBeCloseTo(0.1)
  })
})
