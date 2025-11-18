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
  it('finds the dev logger for changed keys in main store', async () => {
    const res: any = await searchWorkspaceTool.run({
      mode: 'text',
      query: "[main-store] changed keys",
      filters: { pathsInclude: ['electron/store/**'], maxResults: 10, maxSnippetLines: 8 }
    } as any)
    ensureOk(res)
    const out = res.data
    expect(out.results.length).toBeGreaterThan(0)
    const found = out.results.some((h: any) => /main-store\] changed keys/i.test(h.preview || ''))
    expect(found).toBe(true)
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





it('toModelResult minimal contains expanded preview, path and lines on expand', async () => {
  const search: any = await searchWorkspaceTool.run({ mode: 'text', query: 'grepTool', filters: { pathsInclude: ['electron/**'], maxResults: 3, maxSnippetLines: 8 } })
  ensureOk(search)
  const first = search.data.results[0]
  expect(first && first.handle).toBeTruthy()

  const exp: any = await searchWorkspaceTool.run({ action: 'expand', handle: first.handle, filters: { maxSnippetLines: 50 } })
  ensureOk(exp)

  const modelView: any = (searchWorkspaceTool as any).toModelResult(exp)
  expect(modelView && modelView.minimal).toBeTruthy()
  expect(typeof modelView.minimal.previewKey).toBe('string')
  expect(typeof modelView.minimal.preview).toBe('string')
  expect(typeof modelView.minimal.path).toBe('string')
  expect(modelView.minimal.lines && typeof modelView.minimal.lines.start).toBe('number')
})

it('toModelResult minimal includes topHandlesDetailed and snippets on search', async () => {
  const res: any = await searchWorkspaceTool.run({ mode: 'text', query: 'grepTool', filters: { pathsInclude: ['electron/**'], maxResults: 6, maxSnippetLines: 8 } })
  ensureOk(res)
  const modelView: any = (searchWorkspaceTool as any).toModelResult(res)
  expect(modelView && modelView.minimal).toBeTruthy()

  // Detailed handles
  expect(Array.isArray(modelView.minimal.topHandlesDetailed) || modelView.minimal.topHandlesDetailed === undefined).toBe(true)
  if (Array.isArray(modelView.minimal.topHandlesDetailed) && modelView.minimal.topHandlesDetailed.length) {
    const d = modelView.minimal.topHandlesDetailed[0]
    expect(d && typeof d.handle === 'string').toBe(true)
    expect(typeof d.path).toBe('string')
    expect(d.lines && typeof d.lines.start).toBe('number')
  }

  // Snippets
  expect(Array.isArray(modelView.minimal.snippets) || modelView.minimal.snippets === undefined).toBe(true)
  if (Array.isArray(modelView.minimal.snippets) && modelView.minimal.snippets.length) {
    const s = modelView.minimal.snippets[0]
    expect(typeof s.filePath).toBe('string')
    expect(typeof s.preview).toBe('string')
    expect(typeof s.lineStart).toBe('number')
  }
})

it('AST mode maps natural language like "function definition" to patterns and returns results', async () => {
  const res: any = await searchWorkspaceTool.run({
    mode: 'ast',
    query: 'function definition',
    filters: { languages: ['typescript'], pathsInclude: ['electron/**','src/**'], maxResults: 10, maxSnippetLines: 6 }
  } as any)
  ensureOk(res)
  const out = res.data
  expect(Array.isArray(out.results)).toBe(true)
  expect(out.results.length).toBeGreaterThan(0)
  // At least one hit should be classified as AST
  const hasAst = out.results.some((h: any) => h.type === 'AST')
  expect(hasAst).toBe(true)
})

