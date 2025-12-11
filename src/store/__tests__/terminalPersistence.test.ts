import { describe, expect, test, beforeEach, jest } from '@jest/globals'

const STORAGE_PREFIX = 'hifide:terminal:tabs:'

const computeWorkspaceKey = (workspaceId: string | null): string => {
  if (!workspaceId) return `${STORAGE_PREFIX}global`
  try {
    const encoded = Buffer.from(workspaceId, 'utf-8').toString('base64')
    return `${STORAGE_PREFIX}${encoded.replace(/[^a-zA-Z0-9]/g, '')}`
  } catch {
    let hash = 0
    for (let i = 0; i < workspaceId.length; i += 1) {
      hash = ((hash << 5) - hash) + workspaceId.charCodeAt(i)
      hash |= 0
    }
    return `${STORAGE_PREFIX}${Math.abs(hash).toString(36)}`
  }
}

const bindingState: { workspaceId: string | null } = { workspaceId: null }

jest.mock('../binding', () => ({
  useBackendBinding: {
    getState: () => ({
      workspaceId: bindingState.workspaceId,
      setBinding: (payload: { workspaceId?: string | null }) => {
        if ('workspaceId' in payload) {
          bindingState.workspaceId = payload.workspaceId ?? null
        }
      },
      clearBinding: () => {
        bindingState.workspaceId = null
      },
    }),
  },
}))

const { useBackendBinding } = require('../binding') as typeof import('../binding')
const {
  loadTerminalState,
  saveTerminalState,
  clearTerminalState,
} = require('../utils/terminalPersistence') as typeof import('../utils/terminalPersistence')
type TerminalPersistedState = import('../utils/terminalPersistence').TerminalPersistedState

class MemoryStorage {
  private store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }
}

describe('terminalPersistence', () => {
  beforeEach(() => {
    // @ts-expect-error - jsdom mock
    global.localStorage = new MemoryStorage()
    useBackendBinding.getState().clearBinding()
  })

  test('returns default state when nothing persisted', () => {
    const state = loadTerminalState()
    expect(state.explorer.tabs).toHaveLength(0)
    expect(state.explorer.activeId).toBeNull()
    expect(state.agent.tabs).toHaveLength(0)
    expect(state.agent.activeId).toBeNull()
  })

  test('persists isolated state per workspace binding', () => {
    useBackendBinding.getState().setBinding({ workspaceId: '/workspace/a' })
    const explorerStateA: TerminalPersistedState = {
      explorer: {
        tabs: [{ id: 'a1', title: 'Terminal A', createdAt: 1, updatedAt: 1 }],
        activeId: 'a1',
        counter: 1,
      },
      agent: {
        tabs: [],
        activeId: null,
        counter: 0,
      },
    }
    saveTerminalState(explorerStateA)

    useBackendBinding.getState().setBinding({ workspaceId: '/workspace/b' })
    const stateBInitial = loadTerminalState()
    expect(stateBInitial.explorer.tabs).toHaveLength(0)

    const explorerStateB: TerminalPersistedState = {
      explorer: {
        tabs: [{ id: 'b1', title: 'Terminal B', createdAt: 2, updatedAt: 2 }],
        activeId: 'b1',
        counter: 3,
      },
      agent: {
        tabs: [{ id: 'agent1', title: 'Agent', createdAt: 3, updatedAt: 3 }],
        activeId: 'agent1',
        counter: 1,
      },
    }
    saveTerminalState(explorerStateB)

    const reloadedB = loadTerminalState()
    expect(reloadedB.explorer.tabs.map((t) => t.id)).toEqual(['b1'])
    expect(reloadedB.agent.tabs.map((t) => t.id)).toEqual(['agent1'])

    useBackendBinding.getState().setBinding({ workspaceId: '/workspace/a' })
    const reloadedA = loadTerminalState()
    expect(reloadedA.explorer.tabs.map((t) => t.id)).toEqual(['a1'])
    expect(reloadedA.agent.tabs).toHaveLength(0)
  })

  test('sanitizes malformed persisted data', () => {
    useBackendBinding.getState().setBinding({ workspaceId: '/workspace/sanitize' })
    saveTerminalState({
      explorer: { tabs: [], activeId: null, counter: 0 },
      agent: { tabs: [], activeId: null, counter: 0 },
    })

    const storageKey = computeWorkspaceKey('/workspace/sanitize')

    localStorage.setItem(storageKey, JSON.stringify({
      explorer: {
        tabs: [
          { id: '', title: 'bad', createdAt: 'x' },
          { id: 'good', title: ' Terminal ', cwd: '   ', lastDimensions: { cols: '80', rows: '24' } },
        ],
        activeId: 'missing',
        counter: -5,
      },
      agent: {
        tabs: [{ id: 'agent', title: 123 }],
        activeId: 'agent',
        counter: 0,
      },
    }))

    const sanitized = loadTerminalState()
    expect(sanitized.explorer.tabs).toHaveLength(1)
    expect(sanitized.explorer.tabs[0]).toMatchObject({ id: 'good', title: ' Terminal ', cwd: undefined })
    expect(sanitized.explorer.tabs[0]?.lastDimensions).toEqual({ cols: 80, rows: 24 })
    expect(sanitized.explorer.counter).toBeGreaterThanOrEqual(1)
    expect(sanitized.explorer.activeId).toBe('good')
    expect(sanitized.agent.tabs).toHaveLength(0)
  })

  test('clear removes persisted data for current workspace', () => {
    useBackendBinding.getState().setBinding({ workspaceId: '/workspace/clear' })
    saveTerminalState({
      explorer: {
        tabs: [{ id: 'x', title: 'clear', createdAt: 1, updatedAt: 1 }],
        activeId: 'x',
        counter: 1,
      },
      agent: { tabs: [], activeId: null, counter: 0 },
    })

    clearTerminalState()
    const cleared = loadTerminalState()
    expect(cleared.explorer.tabs).toHaveLength(0)
    expect(cleared.explorer.activeId).toBeNull()
  })
})
