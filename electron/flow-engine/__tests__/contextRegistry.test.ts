import { ContextRegistry } from '../contextRegistry'
import type { MainFlowContext } from '../types'

describe('ContextRegistry', () => {
  const baseContext: MainFlowContext = {
    contextId: 'main',
    contextType: 'main',
    provider: 'openai',
    model: 'gpt-4o',
    systemInstructions: 'You are a tester.',
    messageHistory: [],
  }

  it('returns the main binding when resolving without a snapshot', () => {
    const registry = new ContextRegistry(baseContext)
    const binding = registry.resolveFromSnapshot(undefined)
    expect(binding.contextId).toBe('main')
    expect(binding.ref.current.provider).toBe('openai')
  })

  it('creates isolated contexts that inherit defaults from the active binding', () => {
    const registry = new ContextRegistry(baseContext)
    const mainBinding = registry.getMainBinding()
    const isolated = registry.createIsolatedContext({
      systemInstructions: 'New branch',
      temperature: 0.3,
    }, mainBinding)

    expect(isolated.contextType).toBe('isolated')
    expect(isolated.ref.current.provider).toBe('openai')
    expect(isolated.ref.current.model).toBe('gpt-4o')
    expect(isolated.ref.current.systemInstructions).toBe('New branch')
    expect(isolated.ref.current.temperature).toBe(0.3)
    expect(isolated.ref.current.parentContextId).toBe(baseContext.contextId)
  })

  it('can inherit message history from the base binding when requested', () => {
    const registry = new ContextRegistry({
      ...baseContext,
      messageHistory: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    })
    const isolated = registry.createIsolatedContext({ inheritHistory: true }, registry.getMainBinding())
    expect(isolated.ref.current.messageHistory).toHaveLength(2)
    expect(isolated.ref.current.messageHistory[0].content).toBe('Hello')
  })

  it('respects explicit baseContextId when forking from another isolated context', () => {
    const registry = new ContextRegistry(baseContext)
    const mainBinding = registry.getMainBinding()
    const fork = registry.createIsolatedContext({ systemInstructions: 'child' }, mainBinding)
    const fromFork = registry.createIsolatedContext({
      baseContextId: fork.contextId,
      inheritSystemInstructions: true,
    }, mainBinding)

    expect(fromFork.ref.current.parentContextId).toBe(fork.contextId)
    expect(fromFork.ref.current.systemInstructions).toBe('child')
  })

  it('reuses existing bindings when ensuring outputs for known contextIds', () => {
    const registry = new ContextRegistry(baseContext)
    const mainBinding = registry.getMainBinding()
    const clone = registry.cloneContext(mainBinding.ref.current)
    clone.systemInstructions = 'updated'

    const ensured = registry.ensureBindingForOutput(clone, 'main')
    expect(ensured).toBe(mainBinding)
    expect(ensured.ref.current.systemInstructions).toBe('updated')
  })

  it('produces cloned state snapshots', () => {
    const registry = new ContextRegistry(baseContext)
    const binding = registry.createIsolatedContext({ model: 'gpt-4o-mini' }, registry.getMainBinding())
    const snapshot = registry.captureState()

    expect(snapshot.mainContext?.contextId).toBe('main')
    expect(snapshot.isolatedContexts[binding.contextId]).toBeDefined()

    snapshot.mainContext!.provider = 'mutated'
    expect(registry.getMainBinding().ref.current.provider).toBe('openai')
  })

  it('releases isolated contexts when requested', () => {
    const registry = new ContextRegistry(baseContext)
    const isolated = registry.createIsolatedContext({}, registry.getMainBinding())
    expect(registry.captureState().isolatedContexts[isolated.contextId]).toBeDefined()
    expect(registry.releaseContext(isolated.contextId)).toBe(true)
    expect(registry.captureState().isolatedContexts[isolated.contextId]).toBeUndefined()
    expect(registry.releaseContext(baseContext.contextId)).toBe(false)
  })
})
