import { parseUnifiedDiff } from '../gitDiffParser'

describe('parseUnifiedDiff', () => {
  it('parses a single hunk with line numbers', () => {
    const patch = [
      'diff --git a/foo.txt b/foo.txt',
      'index 0000000..1111111 100644',
      '--- a/foo.txt',
      '+++ b/foo.txt',
      '@@ -1,2 +1,3 @@',
      ' line1',
      '-line2',
      '+line2-changed',
      '+line3',
    ].join('\n')

    const parsed = parseUnifiedDiff(patch)
    expect(parsed.isBinary).toBe(false)
    expect(parsed.hunks).toHaveLength(1)

    const [hunk] = parsed.hunks
    expect(hunk.oldStart).toBe(1)
    expect(hunk.oldLines).toBe(2)
    expect(hunk.newStart).toBe(1)
    expect(hunk.newLines).toBe(3)

    expect(hunk.lines.map((l) => l.type)).toEqual(['context', 'del', 'add', 'add'])

    expect(hunk.lines[0]).toMatchObject({ type: 'context', oldLineNumber: 1, newLineNumber: 1, text: 'line1' })
    expect(hunk.lines[1]).toMatchObject({ type: 'del', oldLineNumber: 2, text: 'line2' })
    expect(hunk.lines[2]).toMatchObject({ type: 'add', newLineNumber: 2, text: 'line2-changed' })
    expect(hunk.lines[3]).toMatchObject({ type: 'add', newLineNumber: 3, text: 'line3' })
  })

  it('detects binary diff', () => {
    const patch = 'GIT binary patch\nliteral 0\n'
    const parsed = parseUnifiedDiff(patch)
    expect(parsed.isBinary).toBe(true)
    expect(parsed.hunks).toHaveLength(0)
    expect(parsed.signature.length).toBeGreaterThan(0)
  })
})
