import { describe, it, expect } from '@jest/globals'
import type { ExplorerFsEvent } from '../../../electron/store/types'
import type { TabFsSnapshot } from '../utils/editorConflict'
import { shouldReloadTabFromEvent } from '../utils/editorConflict'

function buildTab(overrides: Partial<TabFsSnapshot> = {}): TabFsSnapshot {
  return {

    mtimeMs: 1_000,

    lastLoadedAt: 1_000,

    ...overrides,
  }
}

function buildEvent(overrides: Partial<ExplorerFsEvent> = {}): ExplorerFsEvent {
  return {
    workspaceRoot: '/workspace',
    path: '/workspace/file.tsx',
    relativePath: 'file.tsx',
    kind: 'file-updated',
    isDirectory: false,
    size: 200,
    mtimeMs: 2_000,
    updatedAt: 2_000,
    ...overrides,
  }
}

describe('shouldReloadTabFromEvent', () => {
  it('returns false for directory events', () => {
    const tab = buildTab()
    const event = buildEvent({ isDirectory: true })
    expect(shouldReloadTabFromEvent(tab, event)).toBe(false)
  })

  it('skips reload when event timestamp is not newer', () => {
    const tab = buildTab({ mtimeMs: 5_000, lastLoadedAt: 5_000 })
    const event = buildEvent({ mtimeMs: 4_000, updatedAt: 4_000 })
    expect(shouldReloadTabFromEvent(tab, event)).toBe(false)
  })

  it('requests reload when event timestamp is newer', () => {
    const tab = buildTab({ mtimeMs: 3_000 })
    const event = buildEvent({ mtimeMs: 4_000, updatedAt: 4_000 })
    expect(shouldReloadTabFromEvent(tab, event)).toBe(true)
  })

  it('relies on updatedAt when mtime is missing', () => {
    const tab = buildTab({ mtimeMs: undefined, lastLoadedAt: 1_000 })
    const event = buildEvent({ mtimeMs: undefined, updatedAt: 2_500 })
    expect(shouldReloadTabFromEvent(tab, event)).toBe(true)
  })
})
