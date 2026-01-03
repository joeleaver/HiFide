import { buildSourceControlLlmContext } from '../llmContext'

describe('buildSourceControlLlmContext', () => {
  it('returns null context when mode is none', () => {
    const res = buildSourceControlLlmContext({
      repoRoot: '/repo',
      mode: 'none',
      diffsByPath: {},
      annotationsByPath: {}
    })
    expect(res.context).toBeNull()
    expect(res.bytes).toBe(0)
    expect(res.truncated).toBe(false)
  })

  it('includes only annotated hunks/files', () => {
    const res = buildSourceControlLlmContext({
      repoRoot: '/repo',
      mode: 'annotated',
      diffsByPath: {
        'a.txt': {
          path: 'a.txt',
          isBinary: false,
          hunks: [
            { header: '@@ -1,1 +1,1 @@', lines: [{ type: 'add', content: '+hello' }] },
            { header: '@@ -2,1 +2,1 @@', lines: [{ type: 'add', content: '+world' }] }
          ]
        } as any,
        'b.txt': {
          path: 'b.txt',
          isBinary: false,
          hunks: [{ header: '@@ -1,1 +1,1 @@', lines: [{ type: 'add', content: '+x' }] }]
        } as any
      },
      annotationsByPath: {
        'a.txt': [
          {
            id: 'ann-1',
            body: 'Please change greeting',
            createdAt: 1,
            updatedAt: 1,
            anchor: {
              kind: 'hunk',
              repoRoot: '/repo',
              filePath: 'a.txt',
              diffBase: 'unstaged',
              hunkIndex: 1,
              contextHash: 'abc'
            }
          }
        ]
      }
    })

    expect(res.context?.items.length).toBe(1)
    const file = res.context?.items[0] as any
    expect(file.path).toBe('a.txt')
    expect(file.hunks.length).toBe(1)
    expect(file.hunks[0].hunkIndex).toBe(1)
    expect(file.hunks[0].annotations.length).toBe(1)
  })

  it('truncates when maxBytes exceeded', () => {
    const res = buildSourceControlLlmContext({
      repoRoot: '/repo',
      mode: 'annotated',
      maxBytes: 200,
      diffsByPath: {
        'a.txt': {
          path: 'a.txt',
          isBinary: false,
          hunks: new Array(10).fill(0).map((_, i) => ({
            header: `@@ -${i},1 +${i},1 @@`,
            lines: new Array(20).fill(0).map((__, j) => ({ type: 'add', content: `+line-${i}-${j}` }))
          }))
        } as any
      },
      annotationsByPath: {
        'a.txt': new Array(10).fill(0).map((_, i) => ({
          id: `ann-${i}`,
          body: 'x'.repeat(50),
          createdAt: 1,
          updatedAt: 1,
          anchor: {
            kind: 'hunk',
            repoRoot: '/repo',
            filePath: 'a.txt',
            diffBase: 'unstaged',
            hunkIndex: i,
            contextHash: 'abc'
          }
        }))
      }
    })

    expect(res.context).not.toBeNull()
    expect(res.truncated).toBe(true)
    expect(res.bytes).toBeLessThanOrEqual(200)
  })

  it('selectedFile mode includes hunks even without annotations', () => {
    const res = buildSourceControlLlmContext({
      repoRoot: '/repo',
      mode: 'selectedFile',
      selectedFilePath: 'a.txt',
      diffsByPath: {
        'a.txt': {
          path: 'a.txt',
          isBinary: false,
          hunks: [
            { header: '@@ -1,1 +1,1 @@', lines: [{ type: 'add', content: '+hello' }] },
            { header: '@@ -2,1 +2,1 @@', lines: [{ type: 'add', content: '+world' }] }
          ]
        } as any
      },
      annotationsByPath: {}
    })

    expect(res.context?.items.length).toBe(1)
    const file = res.context?.items[0] as any
    expect(file.path).toBe('a.txt')
    expect(file.hunks.length).toBe(2)
  })
})

