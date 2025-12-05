import { formatMessagesForOpenAI, formatMessagesForGemini } from '../llm/payloads'
import type { MainFlowContext } from '../types'

describe('formatMessagesForOpenAI', () => {
  const baseContext: MainFlowContext = {
    contextId: 'ctx',
    provider: 'fireworks',
    model: 'accounts/fireworks/models/glm-4',
    messageHistory: [
      { role: 'assistant', content: 'Final output', reasoning: 'Tool thoughts' },
    ],
  }

  it('replays reasoning blocks for Fireworks providers', () => {
    const messages = formatMessagesForOpenAI(baseContext, { provider: 'fireworks' })
    const assistant = messages.find((msg) => msg.role === 'assistant')
    expect(assistant?.content).toContain('<think>Tool thoughts</think>')
    expect(assistant?.content).toContain('Final output')
  })

  it('keeps reasoning hidden for non-reasoning providers', () => {
    const messages = formatMessagesForOpenAI(baseContext, { provider: 'openai' })
    const assistant = messages.find((msg) => msg.role === 'assistant')
    expect(assistant?.content).toBe('Final output')
  })
})

describe('formatMessagesForGemini', () => {
  it('emits thinking parts ahead of assistant replies', () => {
    const ctx: MainFlowContext = {
      contextId: 'ctx-g',
      provider: 'gemini',
      model: 'gemini-2.0-flash-thinking',
      messageHistory: [
        { role: 'assistant', content: 'Ready to assist', reasoning: 'Inspecting tools' },
      ],
    }

    const payload = formatMessagesForGemini(ctx)
    const first = payload.contents[0]
    expect(first.parts[0].text).toContain('<think>Inspecting tools</think>')
    expect(first.parts[1].text).toBe('Ready to assist')
  })
})
