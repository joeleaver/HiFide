import { extractMemoriesNode } from '../extractMemories'
import { llmService } from '../../llm-service'

jest.mock('../../llm-service', () => ({
  llmService: {
    chat: jest.fn(),
  },
}))

jest.mock('../../../store/utils/memories', () => ({
  applyMemoryCandidates: jest.fn(async () => ({ created: 1, updated: 0, skipped: 0 })),
}))

function makeFlow(history: Array<{ role: 'user' | 'assistant'; content: string }>) {
  const ctx: any = {
    contextId: 'main',
    provider: 'openai',
    model: 'gpt-4o',
    systemInstructions: 'BASE',
    messageHistory: history,
  }

  const manager = {
    get: () => ctx,
    setSystemInstructions: (text: string) => { ctx.systemInstructions = text },
  }

  return {
    nodeId: 'extract-1',
    workspaceId: '/tmp/workspace',
    context: manager,
    log: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() },
  } as any
}

describe('extractMemories node', () => {
  it('calls LLM with last user/assistant pair and writes candidates', async () => {
    const flow = makeFlow([
      { role: 'user', content: 'U1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'U2' },
      { role: 'assistant', content: 'A2' },
    ])

    ;(llmService.chat as any).mockResolvedValue({ text: JSON.stringify({
      items: [{ type: 'decision', text: 'Use pnpm', tags: ['tooling'], importance: 0.5 }]
    }) })

    const inputs: any = { has: () => false, pull: async () => null }
    const res = await extractMemoriesNode(flow, flow.context.get(), 'data', inputs, { provider: 'openai', model: 'gpt-4o-mini', lookbackPairs: 1 })

    expect(res.status).toBe('success')
    expect(llmService.chat).toHaveBeenCalledTimes(1)

    const call = (llmService.chat as any).mock.calls[0][0]
    expect(call.skipHistory).toBe(true)
    expect(String(call.message)).toContain('User: U2')
    expect(String(call.message)).toContain('Assistant: A2')
  })

  it('noops when no complete pairs exist', async () => {
    ;(llmService.chat as any).mockClear()
    const flow = makeFlow([{ role: 'user', content: 'U1' }])
    const inputs: any = { has: () => false, pull: async () => null }
    const res = await extractMemoriesNode(flow, flow.context.get(), 'data', inputs, { provider: 'openai', model: 'gpt-4o-mini', lookbackPairs: 2 })

    expect(res.status).toBe('success')
    expect(llmService.chat).toHaveBeenCalledTimes(0)
  })
})
