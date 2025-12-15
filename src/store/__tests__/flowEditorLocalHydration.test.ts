import { decideHydrationStrategy } from '../flowEditorLocalStrategy'
import { shouldHydrateFlowGraphChange } from '../../../shared/flowGraph'

describe('flowEditorLocal hydration strategy', () => {
  it('applies backend graph when store is not yet hydrated', () => {
    const result = decideHydrationStrategy({
      isHydrated: false,
      localSignature: 'local',
      savedSignature: 'saved',
      incomingSignature: 'incoming',
    })
    expect(result).toBe('apply')
  })

  it('skips identical graphs when already hydrated', () => {
    const result = decideHydrationStrategy({
      isHydrated: true,
      localSignature: 'sig',
      savedSignature: 'sig',
      incomingSignature: 'sig',
    })
    expect(result).toBe('skip-identical')
  })

  it('skips stale snapshots when local edits exist after the last save', () => {
    const result = decideHydrationStrategy({
      isHydrated: true,
      localSignature: 'local-newer',
      savedSignature: 'saved-old',
      incomingSignature: 'saved-old',
    })
    expect(result).toBe('skip-stale-snapshot')
  })

  it('applies remote updates when they differ from both local and last save', () => {
    const result = decideHydrationStrategy({
      isHydrated: true,
      localSignature: 'local',
      savedSignature: 'saved',
      incomingSignature: 'remote',
    })
    expect(result).toBe('apply')
  })
})


describe('flowEditorLocal graph change reasons', () => {
  it('hydrates for workspace snapshots', () => {
    expect(shouldHydrateFlowGraphChange('workspace-snapshot')).toBe(true)
  })

  it('hydrates for template loads', () => {
    expect(shouldHydrateFlowGraphChange('template-load')).toBe(true)
  })

  it('skips autosave echoes and unknown reasons', () => {
    expect(shouldHydrateFlowGraphChange('autosave')).toBe(false)
    expect(shouldHydrateFlowGraphChange('unknown')).toBe(false)
    expect(shouldHydrateFlowGraphChange(undefined)).toBe(false)
  })
})
