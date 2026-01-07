import type { TokenCost } from '../store/types.js'

export type NormalizedTokenCost = {
  inputCost: number
  cachedCost: number
  outputCost: number
  totalCost: number
  currency: string
}

export function normalizeTokenCostSnapshot(cost?: TokenCost | null): NormalizedTokenCost {
  const inputCost = Number(cost?.inputCost ?? 0)
  const cachedCost = Number((cost as any)?.cachedCost ?? (cost as any)?.cachedInputCost ?? 0)
  const outputCost = Number(cost?.outputCost ?? 0)
  const totalCost = Number.isFinite(Number(cost?.totalCost))
    ? Number(cost?.totalCost)
    : inputCost + cachedCost + outputCost
  const currency = typeof cost?.currency === 'string' ? cost.currency : 'USD'

  return { inputCost, cachedCost, outputCost, totalCost, currency }
}

export function mergeCostBucket(existing: TokenCost | undefined, delta: NormalizedTokenCost): TokenCost {
  const target: TokenCost = existing || {
    inputCost: 0,
    outputCost: 0,
    totalCost: 0,
    currency: delta.currency,
  }

  target.inputCost = Number(target.inputCost || 0) + delta.inputCost
  target.outputCost = Number(target.outputCost || 0) + delta.outputCost

  const prevCached = Number((target as any).cachedCost ?? (target as any).cachedInputCost ?? 0)
  ;(target as any).cachedCost = prevCached + delta.cachedCost

  // Recalculate totalCost from the three components to ensure consistency
  target.totalCost = target.inputCost + (target as any).cachedCost + target.outputCost

  return target
}

export function serializeNormalizedCost(delta: NormalizedTokenCost): TokenCost {
  const snapshot: TokenCost = {
    inputCost: delta.inputCost,
    outputCost: delta.outputCost,
    // Recalculate totalCost from the three components to ensure consistency
    totalCost: delta.inputCost + delta.cachedCost + delta.outputCost,
    currency: delta.currency,
  }

  if (delta.cachedCost > 0) {
    ;(snapshot as any).cachedCost = delta.cachedCost
  }

  return snapshot
}
