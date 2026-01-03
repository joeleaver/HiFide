import { computeDiffContextHash, reattachAnchor } from '../utils/diffAnchor'
import type { DiffAnchor } from '../../shared/sourceControlAnnotations'
import type { GitDiffLine } from '../../shared/git'

function line(type: GitDiffLine['type'], content: string): GitDiffLine {
  return { type, text: content, oldLineNumber: undefined, newLineNumber: undefined }
}

describe('diffAnchor', () => {
  test('computeDiffContextHash is stable for same window', () => {
    const lines: GitDiffLine[] = [
      line('context', 'a'),
      line('add', 'b'),
      line('context', 'c'),
    ]

    const h1 = computeDiffContextHash(lines, 1)
    const h2 = computeDiffContextHash(lines, 1)
    expect(h1).toEqual(h2)
  })

  test('reattachAnchor finds same hunk/line when diff is unchanged', () => {
    const lines: GitDiffLine[] = [
      line('context', 'fn a() {'),
      line('add', '  const x = 1'),
      line('context', '}'),
    ]
    const contextHash = computeDiffContextHash(lines, 1)

    const anchor: DiffAnchor = {
      kind: 'line',
      repoRoot: '/repo',
      filePath: 'a.ts',
      diffBase: 'unstaged',
      hunkIndex: 0,
      side: 'right',
      lineOffsetInHunk: 1,
      contextHash,
    }

    const res = reattachAnchor(anchor, [{ lines }])
    expect(res).toEqual({ ok: true, hunkIndex: 0, lineOffsetInHunk: 1 })
  })
})

