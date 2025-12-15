import { describe, expect, it } from '@jest/globals'
import { inferContentType } from '../inferContentType'

describe('inferContentType', () => {
  it('detects workspace-search for camelCase variants', () => {
    expect(inferContentType('workspaceSearch')).toBe('workspace-search')
    expect(inferContentType('searchWorkspace')).toBe('workspace-search')
  })

  it('detects workspace-search for dotted variant', () => {
    expect(inferContentType('workspace.search')).toBe('workspace-search')
  })

  it('maps other known tools', () => {
    expect(inferContentType('edits.applyPatch')).toBe('diff')
    expect(inferContentType('fs.read_lines')).toBe('read-lines')
    expect(inferContentType('knowledgeBase.search')).toBe('kb-search')
    expect(inferContentType('knowledgeBaseSearch')).toBe('kb-search')
    expect(inferContentType('knowledgeBase.store')).toBe('kb-store')
    expect(inferContentType('index.search')).toBe('search')
    expect(inferContentType('terminalExec')).toBe('terminal-exec')
    expect(inferContentType('terminal.exec')).toBe('terminal-exec')
  })

  it('falls back to json for unknown tools', () => {
    expect(inferContentType('unknownTool')).toBe('json')
    expect(inferContentType(undefined)).toBe('json')
  })
})
