import { searchWorkspaceTool } from '../searchWorkspace'

function ensureOk(res: any) {
  expect(res).toBeTruthy()
  expect(res.ok).toBe(true)
  expect(res.data).toBeTruthy()
}

describe('workspace.search tool', () => {
  it('performs a basic text search and returns results', async () => {
    const res: any = await searchWorkspaceTool.run({
      query: 'grepTool',
      filters: { pathsInclude: ['electron/**'], maxResults: 10 }
    })
    ensureOk(res)
    const out = res.data
    expect(Array.isArray(out.results)).toBe(true)
    expect(out.results.length).toBeGreaterThan(0)

    // Results should have path, lineNumber, and line
    for (const r of out.results) {
      expect(typeof r.path).toBe('string')
      expect(typeof r.lineNumber).toBe('number')
      expect(typeof r.line).toBe('string')
    }

    // Expect at least one hit to include the token
    const hasToken = out.results.some((r: any) => /grepTool/.test(r.line || ''))
    expect(hasToken).toBe(true)
  })

  it('finds the doc comment for the main process Zustand store', async () => {
    const res: any = await searchWorkspaceTool.run({
      query: 'Zustand store for the main process',
      filters: { pathsInclude: ['electron/store/**'], maxResults: 10 }
    })
    ensureOk(res)
    const out = res.data

    expect(out.results.length).toBeGreaterThan(0)
    const found = out.results.some((r: any) => /Zustand store for the main process/i.test(r.line || ''))
    expect(found).toBe(true)
  })

  it('falls back to tokenized mode when no phrase match exists', async () => {
    const res: any = await searchWorkspaceTool.run({
      query: 'fallback ranking tokenized search',
      filters: { pathsInclude: ['electron/tools/workspace/**'], pathsExclude: ['**/__tests__/**'], maxResults: 5 }
    })
    ensureOk(res)
    const out = res.data

    expect(out.meta?.mode).toBe('tokenized')
    expect(out.results.length).toBeGreaterThan(0)
    expect(out.summary.toLowerCase()).toContain('tokenized search')
    expect(Array.isArray(out.meta?.tokens)).toBe(true)
    expect(out.meta.tokens.length).toBeGreaterThan(1)
  })

  it('falls back to path matching when only file paths match the query', async () => {
    const res: any = await searchWorkspaceTool.run({
      query: 'path-only-match-omega',
      filters: { pathsInclude: ['electron/tools/workspace/__tests__/fixtures/**'], maxResults: 5 }
    })
    ensureOk(res)
    const out = res.data

    expect(out.meta?.mode).toBe('path')
    expect(out.results.length).toBeGreaterThan(0)
    expect(out.summary.toLowerCase()).toContain('path search')
    const includesPath = out.results.some((r: any) => /path-only-match-omega/.test(r.path || ''))
    expect(includesPath).toBe(true)
  })

  it('omits previewKey from the minimal payload while preserving UI metadata', () => {
    const raw = {
      ok: true,
      data: {
        summary: 'sample summary',
        count: 1,
        results: [
          {
            path: 'file.ts',
            lineNumber: 10,
            line: 'const sample = true'
          }
        ]
      }
    }

    const formatted = searchWorkspaceTool.toModelResult?.(raw)
    expect(formatted?.minimal?.previewKey).toBeUndefined()
    expect(formatted?.previewKey).toBeDefined()
    expect(formatted?.ui).toEqual(raw.data)
  })
})

