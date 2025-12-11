import { describe, it, expect } from '@jest/globals'
import { buildEditorPersistenceState } from '../utils/editorSnapshot'

describe('buildEditorPersistenceState', () => {
  it('excludes preview tabs from persistence payload', () => {
    const result = buildEditorPersistenceState([
      { id: 'a', path: '/workspace/a.ts', viewMode: 'source', isPreview: false },
      { id: 'b', path: '/workspace/b.tsx', viewMode: 'source', isPreview: true },
    ], 'a')

    expect(result.tabs).toEqual([
      { path: '/workspace/a.ts', viewMode: 'source' },
    ])
    expect(result.activePath).toBe('/workspace/a.ts')
  })

  it('clears activePath when the active tab is preview-only', () => {
    const result = buildEditorPersistenceState([
      { id: 'a', path: '/workspace/a.ts', viewMode: 'source', isPreview: true },
      { id: 'b', path: '/workspace/b.ts', viewMode: 'source', isPreview: false },
    ], 'a')

    expect(result.tabs).toEqual([
      { path: '/workspace/b.ts', viewMode: 'source' },
    ])
    expect(result.activePath).toBeNull()
  })

  it('excludes untitled tabs from persistence payload', () => {
    const result = buildEditorPersistenceState([
      { id: 'untitled-1', path: 'untitled-1', viewMode: 'source', isPreview: false, isUntitled: true },
      { id: 'saved', path: '/workspace/saved.md', viewMode: 'rich', isPreview: false },
    ], 'untitled-1')

    expect(result.tabs).toEqual([
      { path: '/workspace/saved.md', viewMode: 'rich' },
    ])
    expect(result.activePath).toBeNull()
  })
})
