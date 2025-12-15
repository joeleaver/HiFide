export type HydrationDecision = 'apply' | 'skip-identical' | 'skip-stale-snapshot'

export interface HydrationStrategyInputs {
  isHydrated: boolean
  localSignature: string
  savedSignature: string
  incomingSignature: string
}

export const decideHydrationStrategy = ({
  isHydrated,
  localSignature,
  savedSignature,
  incomingSignature,
}: HydrationStrategyInputs): HydrationDecision => {
  if (!isHydrated) {
    return 'apply'
  }

  if (incomingSignature === localSignature) {
    return 'skip-identical'
  }

  if (incomingSignature === savedSignature && localSignature !== savedSignature) {
    return 'skip-stale-snapshot'
  }

  return 'apply'
}
