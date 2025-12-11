import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { loadEditorState, saveEditorState, clearEditorState } from '../utils/editorPersistence'
import { useBackendBinding } from '../binding'

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

beforeEach(() => {
  // @ts-expect-error - test environment mock
  global.localStorage = new MemoryStorage()
  useBackendBinding.getState().clearBinding()
})

describe('editorPersistence', () => {
  it('returns default state when nothing is stored', () => {
    const state = loadEditorState()
    expect(state).toEqual({ tabs: [], activePath: null })
  })

  it('persists editor state per workspace', () => {
    useBackendBinding.getState().setBinding({ workspaceId: '/workspace/a' })
    saveEditorState({
      tabs: [
        { path: '/workspace/a/src/index.ts', viewMode: 'source' },
      ],
      activePath: '/workspace/a/src/index.ts',
    })

    const loadedA = loadEditorState()
    expect(loadedA.tabs).toHaveLength(1)
    expect(loadedA.activePath).toBe('/workspace/a/src/index.ts')

    useBackendBinding.getState().setBinding({ workspaceId: '/workspace/b' })
    const loadedB = loadEditorState()
    expect(loadedB.tabs).toHaveLength(0)
    expect(loadedB.activePath).toBeNull()
  })

  it('sanitizes invalid persisted data', () => {
    useBackendBinding.getState().setBinding({ workspaceId: '/workspace/sanitize' })
    saveEditorState({
      // @ts-expect-error - intentional invalid view mode for test
      tabs: [{ path: '/note.md', viewMode: 'rich' }, { path: '/script.ts', viewMode: 'invalid' }],
      activePath: '/note.md',
    })

    const loaded = loadEditorState()
    expect(loaded.tabs).toEqual([
      { path: '/note.md', viewMode: 'rich' },
      { path: '/script.ts', viewMode: undefined },
    ])
  })

  it('clears state for current workspace', () => {
    useBackendBinding.getState().setBinding({ workspaceId: '/workspace/clear' })
    saveEditorState({
      tabs: [{ path: '/workspace/clear/file.ts', viewMode: 'source' }],
      activePath: '/workspace/clear/file.ts',
    })

    clearEditorState()
    const loaded = loadEditorState()
    expect(loaded.tabs).toHaveLength(0)
    expect(loaded.activePath).toBeNull()
  })
})
