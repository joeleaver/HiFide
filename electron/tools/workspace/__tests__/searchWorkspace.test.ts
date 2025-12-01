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

  it('finds the dev logger for changed keys in main store', async () => {
    const res: any = await searchWorkspaceTool.run({
      query: "[main-store] changed keys",
      filters: { pathsInclude: ['electron/store/**'], maxResults: 10 }
    })
    ensureOk(res)
    const out = res.data
    expect(out.results.length).toBeGreaterThan(0)
    const found = out.results.some((r: any) => /main-store\] changed keys/i.test(r.line || ''))
    expect(found).toBe(true)
  })
})

