import { searchWorkspaceTool } from '../searchWorkspace'
import { computeAutoBudget } from '../searchWorkspace'


function ensureOk(res: any) {
  expect(res).toBeTruthy()
  expect(res.ok).toBe(true)
  expect(res.data).toBeTruthy()
}

describe('workspace.search tool', () => {
  it('performs a basic text search and returns compact results', async () => {
    const res: any = await searchWorkspaceTool.run({
      mode: 'text',
      query: 'grepTool',
      filters: { pathsInclude: ['electron/**'], maxResults: 10, maxSnippetLines: 8, timeBudgetMs: 20_000 }
    })
    ensureOk(res)
    const out = res.data
    expect(Array.isArray(out.results)).toBe(true)
    expect(out.results.length).toBeGreaterThan(0)

    // Expect at least one hit to include the token in preview (source or references)
    const hasToken = out.results.some((h: any) => /grepTool/.test(h.preview || ''))
    expect(hasToken).toBe(true)

    // Results should be compact
    for (const h of out.results) {
      const previewLines = (h.preview || '').split(/\r?\n/)
      expect(previewLines.length).toBeLessThanOrEqual(8 + 1) // account for possible ellipsis line
    }
  })

  it('expands a handle to include more context', async () => {
    const res: any = await searchWorkspaceTool.run({ mode: 'text', query: 'grepTool', filters: { pathsInclude: ['electron/**'], maxResults: 3 } })
    ensureOk(res)
    const first = res.data.results[0]
    expect(first.handle).toBeTruthy()

    const exp: any = await searchWorkspaceTool.run({ action: 'expand', query: 'ignored', handle: first.handle, filters: { maxSnippetLines: 50 } })
    ensureOk(exp)
    expect(exp.data.preview && exp.data.preview.length).toBeGreaterThan(0)
    expect(typeof exp.data.path).toBe('string')
    expect(exp.data.lines.start).toBeGreaterThan(0)
  })
})

  it('supports multi-query batching and annotates matchedQueries', async () => {
    const res: any = await searchWorkspaceTool.run({
      mode: 'text',
      queries: ['grepTool', 'searchWorkspace'],
      filters: { pathsInclude: ['electron/**'], maxResults: 15, maxSnippetLines: 8 }
    } as any)
    ensureOk(res)
    const out = res.data
    expect(out.results.length).toBeGreaterThan(0)
    const hasMatched = out.results.some((h: any) => Array.isArray(h.matchedQueries) && h.matchedQueries.length > 0)
    expect(hasMatched).toBe(true)
  })


  it('auto-scales time budget with query count and ignores too-low provided budgets', () => {
    // Single term should be at least base
    expect(computeAutoBudget(1, undefined)).toBeGreaterThanOrEqual(10_000)
    // Many terms should lift low provided budgets
    const eightTerms = computeAutoBudget(8, 5_000)
    expect(eightTerms).toBeGreaterThan(5_000)
    expect(eightTerms).toBeGreaterThanOrEqual(10_000 + 7 * 1_500)
    // Cap should apply
    expect(computeAutoBudget(50, undefined)).toBeLessThanOrEqual(30_000)
  })


