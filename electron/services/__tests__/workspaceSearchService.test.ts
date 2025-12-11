import { applyReplacementsToContent } from '../WorkspaceSearchService'
import type { WorkspaceReplaceMatch } from '../../../shared/search'

describe('applyReplacementsToContent', () => {
  it('replaces segments based on line/column positions', () => {
    const content = 'const foo = 1;\nconst bar = 2;'
    const matches: WorkspaceReplaceMatch[] = [
      {
        start: { line: 1, column: 7 },
        end: { line: 1, column: 10 },
        replacement: 'baz',
      },
      {
        start: { line: 2, column: 7 },
        end: { line: 2, column: 10 },
        replacement: 'qux',
      },
    ]

    const result = applyReplacementsToContent(content, matches)
    expect(result.content).toBe('const baz = 1;\nconst qux = 2;')
    expect(result.applied).toBe(2)
    expect(result.changed).toBe(true)
  })

  it('handles overlapping replacements safely by applying from bottom of file', () => {
    const content = 'aaaaa'
    const matches: WorkspaceReplaceMatch[] = [
      { start: { line: 1, column: 2 }, end: { line: 1, column: 4 }, replacement: 'bc' },
      { start: { line: 1, column: 4 }, end: { line: 1, column: 6 }, replacement: 'de' },
    ]

    const result = applyReplacementsToContent(content, matches)
    expect(result.content).toBe('abcde')
    expect(result.applied).toBe(2)
  })

  it('returns original content when there are no matches', () => {
    const content = 'sample text'
    const result = applyReplacementsToContent(content, [])
    expect(result.content).toBe(content)
    expect(result.applied).toBe(0)
    expect(result.changed).toBe(false)
  })
})
