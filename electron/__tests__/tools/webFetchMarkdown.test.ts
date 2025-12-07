const HTML_FIXTURE = `<!doctype html>
<html>
  <head>
    <title>Fixture Title</title>
    <style>body { color: red; }</style>
  </head>
  <body>
    <main>
      <h1>Hello Headline</h1>
      <p>Lead paragraph.</p>
      <pre data-lang="ts">console.log('hi')</pre>
      <script>console.log('secret')</script>
      <aside>Sidebar note</aside>
    </main>
  </body>
</html>`

const GLOBAL_HTML_KEY = '__webFetchMarkdownHtml'
const isLive = process.env.TEST_MODE === 'live'

if (!isLive) {
  jest.mock('crawlee', () => {
    const { load } = require('cheerio')
    return {
      CheerioCrawler: class {
        private requestHandler: any
        private preNavigationHooks: Array<(ctx: any) => Promise<void> | void>

        constructor(options: any) {
          this.requestHandler = options.requestHandler
          this.preNavigationHooks = options.preNavigationHooks || []
        }

        async run(urls: string[]) {
          if ((globalThis as any).__webFetchMarkdownSkipCrawler) {
            return
          }
          const [url] = urls
          const request = { url, loadedUrl: url, headers: {} as Record<string, string> }
          for (const hook of this.preNavigationHooks) {
            await hook({ request })
          }
          const html = (globalThis as any)[GLOBAL_HTML_KEY] || HTML_FIXTURE
          const $ = load(html)
          await this.requestHandler({
            request,
            response: { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
            $,
            contentType: { type: 'text', subtype: 'html' },
          })
        }
      },
    }
  })
}

import { webFetchMarkdownTool } from '../../tools/web/fetchMarkdown'

const setMockHtml = (html: string) => {
  ;(globalThis as any)[GLOBAL_HTML_KEY] = html
}

const describeMocked = isLive ? describe.skip : describe
describeMocked('webFetchMarkdownTool (mocked)', () => {
  beforeEach(() => {
    setMockHtml(HTML_FIXTURE)
    delete (globalThis as any).__webFetchMarkdownSkipCrawler
  })

  afterAll(() => {
    delete (globalThis as any)[GLOBAL_HTML_KEY]
    delete (globalThis as any).__webFetchMarkdownSkipCrawler
  })

  it('rejects non-http protocols', async () => {
    const res: any = await webFetchMarkdownTool.run({ url: 'ftp://example.com/file.txt' })
    expect(res.ok).toBe(false)
    expect(String(res.error)).toMatch(/http/i)
  })

  it('fetches HTML and returns Markdown', async () => {
    const res: any = await webFetchMarkdownTool.run({
      url: 'https://example.com/article',
      selector: 'main',
      stripSelectors: ['aside'],
    })

    expect(res.ok).toBe(true)
    const data = res.data
    expect(data.title).toBe('Fixture Title')
    expect(data.selectorUsed).toBe('main')
    expect(data.statusCode).toBe(200)
    expect(data.removedSelectors).toEqual(expect.arrayContaining(['script', 'style', 'aside']))
    expect(data.markdown).toContain('# Hello Headline')
    expect(data.markdown).toContain('Lead paragraph')
    expect(data.markdown).toContain('```ts')
    expect(data.markdown).not.toContain("console.log('secret')")
    expect(data.markdown).not.toContain('Sidebar note')
    expect(data.markdownLength).toBe(data.markdown.length)
    expect(typeof data.fetchedAt).toBe('string')
  })

  it('filters Markdown when a search query matches', async () => {
    const res: any = await webFetchMarkdownTool.run({
      url: 'https://example.com/article',
      selector: 'main',
      search: 'headline paragraph',
    })

    expect(res.ok).toBe(true)
    const data = res.data
    expect(data.fullMarkdownLength).toBeGreaterThanOrEqual(data.markdownLength)
    expect(data.searchSummary?.filtered).toBe(true)
    expect(data.searchSummary?.terms).toEqual(expect.arrayContaining(['headline', 'paragraph']))
    expect(data.searchSummary?.contexts?.length).toBeGreaterThan(0)
    expect(data.markdown).toContain('Hello Headline')
  })

  it('warns when search produces no matches', async () => {
    const res: any = await webFetchMarkdownTool.run({
      url: 'https://example.com/article',
      selector: 'main',
      search: 'nonexistentterm',
    })

    expect(res.ok).toBe(true)
    const data = res.data
    expect(data.fullMarkdownLength).toBe(data.markdownLength)
    expect(data.searchSummary?.filtered).toBe(false)
    expect(data.searchSummary?.matchCount).toBe(0)
    expect(data.warning).toMatch(/no matches/i)
  })

  it('summarizes payload via toModelResult', () => {
    const raw = {
      ok: true,
      data: {
        finalUrl: 'https://example.com/article',
        requestedUrl: 'https://example.com/article',
        title: 'Example Article',
        statusCode: 200,
        selectorUsed: 'body',
        fetchedAt: '2024-01-01T00:00:00.000Z',
        markdown: 'a'.repeat(1300),
        markdownLength: 1300,
      },
    }

    const result = webFetchMarkdownTool.toModelResult?.(raw as any)
    expect(result).toBeDefined()
    const preview = result?.minimal?.markdownPreview
    expect(preview).toEqual(expect.any(String))
    expect((preview as string).endsWith('…')).toBe(true)
    expect((preview as string).length).toBe(1201)
    expect(result?.minimal?.title).toBe('Example Article')
    expect(result?.minimal?.markdownLength).toBe(1300)
    expect(result?.ui).toBe(raw.data)
  })

  it('falls back to direct fetch when crawler yields no content', async () => {
    ;(globalThis as any).__webFetchMarkdownSkipCrawler = true
    const fetchSpy = jest
      .spyOn(globalThis as any, 'fetch')
      .mockImplementation(async () => ({
        status: 200,
        url: 'https://fallback.example.com/article',
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        text: async () => HTML_FIXTURE,
      }) as Response)

    const res: any = await webFetchMarkdownTool.run({ url: 'https://fallback.example.com/article' })
    expect(res.ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalled()
    expect(res.data?.markdown).toContain('Hello Headline')

    fetchSpy.mockRestore()
    delete (globalThis as any).__webFetchMarkdownSkipCrawler
  })
})

const describeLive = isLive ? describe : describe.skip
describeLive('webFetchMarkdownTool live', () => {
  it('captures ai-sdk.dev image inputs section', async () => {
    const res: any = await webFetchMarkdownTool.run({
      url: 'https://ai-sdk.dev/providers/ai-sdk-providers/openai#image-inputs',
      selector: 'main',
    })

    expect(res.ok).toBe(true)
    expect(res.data?.markdown).toContain('Image Inputs')
  })
})