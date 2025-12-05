import { resolveSamplingControls } from '../../llm/stream-options'
import type { MainFlowContext } from '../../types'

function buildContext(overrides: Partial<MainFlowContext> = {}): MainFlowContext {
  return {
    contextId: 'ctx-test',
    provider: overrides.provider ?? 'openai',
    model: overrides.model ?? 'gpt-4o',
    messageHistory: [],
    ...overrides,
  }
}

describe('resolveSamplingControls', () => {
  it('prefers per-model temperature override over normalized base temperature', () => {
    const workingContext = buildContext({
      temperature: 0.25, // normalized base value (would map to 0.5 for OpenAI)
      modelOverrides: [
        {
          model: 'gpt-4o',
          temperature: 1.3,
        },
      ],
    }) as MainFlowContext & { modelOverrides: Array<{ model: string; temperature: number }> }

    const controls = resolveSamplingControls({
      provider: 'openai',
      model: 'gpt-4o',
      workingContext,
    })

    expect(controls.temperature).toBe(1.3)
  })

  it('falls back to normalized base temperature when no matching override exists', () => {
    const workingContext = buildContext({
      temperature: 0.4, // normalized (0-1)
      modelOverrides: [
        {
          model: 'claude-3-5-sonnet',
          temperature: 0.6,
        },
      ],
    }) as MainFlowContext & { modelOverrides: Array<{ model: string; temperature: number }> }

    const controls = resolveSamplingControls({
      provider: 'openai',
      model: 'gpt-4o',
      workingContext,
    })

    expect(controls.temperature).toBeCloseTo(0.8)
  })
})
