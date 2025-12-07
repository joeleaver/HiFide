import type { AgentTool } from '../../providers/provider'
import { CheerioCrawler } from 'crawlee'
import { load, type CheerioAPI } from 'cheerio'
import TurndownService from 'turndown'
import { randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

const DEFAULT_USER_AGENT = 'HiFiDEBot/1.0 (+https://github.com/joeleaver/hifide)'
const DEFAULT_TIMEOUT_MS = 15000
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 60000
const PREVIEW_LIMIT = 1200
const SELECTOR_MAX_LENGTH = 200
const DEFAULT_REMOVALS = ['script', 'style', 'noscript', 'template', 'iframe', 'svg']
const DEFAULT_ACCEPT_HEADER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
const SEARCH_QUERY_MAX_LENGTH = 256
const SEARCH_CONTEXT_LINES_BEFORE = 50
const SEARCH_CONTEXT_LINES_AFTER = 50
const SEARCH_MAX_CONTEXTS = 6

interface FetchMarkdownArgs {
  url: string
  selector?: string
  timeoutMs?: number
  userAgent?: string
  stripSelectors?: string[]
  search?: string
}

interface FetchMarkdownResult {
  requestedUrl: string
  finalUrl: string
  title?: string
  statusCode: number | null
  selectorUsed: string
  removedSelectors: string[]
  markdown: string
  markdownLength: number
  fetchedAt: string
  headers?: Record<string, string | string[]>
  contentType?: string
  userAgentApplied: string
  timing: { elapsedMs: number }
  warning?: string
  fullMarkdownLength?: number
  searchSummary?: SearchSummary
}

interface SearchContextSegment {
  snippet: string
  startLine: number
  endLine: number
  matchedTerms: string[]
}

interface SearchSummary {
  query: string
  terms: string[]
  matchCount: number
  contextCount: number
  filtered: boolean
  contexts: SearchContextSegment[]
}

function validateHttpUrl(value: string | undefined): URL {
  if (!value || typeof value !== 'string') {
    throw new Error('A non-empty HTTP(S) URL is required')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Invalid URL: unable to parse value')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are supported')
  }
  return parsed
}

function clampTimeout(timeout?: number): number {
  if (typeof timeout !== 'number' || Number.isNaN(timeout)) {
    return DEFAULT_TIMEOUT_MS
  }
  const clamped = Math.min(Math.max(timeout, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
  return Math.round(clamped)
}

function sanitizeSelector(selector?: string): string {
  if (!selector || typeof selector !== 'string') return 'body'
  const trimmed = selector.trim()
  if (!trimmed) return 'body'
  return trimmed.slice(0, SELECTOR_MAX_LENGTH)
}

function buildRemovalList(userList?: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  const source = [...DEFAULT_REMOVALS, ...(Array.isArray(userList) ? userList : [])]
  for (const raw of source) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    const normalized = trimmed.slice(0, SELECTOR_MAX_LENGTH)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    output.push(normalized)
  }
  return output
}

function normalizeHeaders(headers?: IncomingHttpHeaders): Record<string, string | string[]> | undefined {
  if (!headers) return undefined
  const normalized: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'undefined') continue
    normalized[key.toLowerCase()] = value
  }
  return Object.keys(normalized).length ? normalized : undefined
}

function sanitizeUserAgent(input?: string): string {
  if (!input || typeof input !== 'string') return DEFAULT_USER_AGENT
  const trimmed = input.trim()
  if (!trimmed) return DEFAULT_USER_AGENT
  return trimmed.slice(0, 256)
}

function sanitizeSearchQuery(raw?: string): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, SEARCH_QUERY_MAX_LENGTH)
}

function tokenizeSearchTerms(query: string): string[] {
  const tokens = query
    .split(/[\s,]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 2)

  const deduped: string[] = []
  for (const token of tokens) {
    if (!deduped.includes(token)) {
      deduped.push(token)
    }
  }
  return deduped
}

function collectSearchContexts(markdown: string, terms: string[]): { contexts: SearchContextSegment[]; matchCount: number } {
  const lines = markdown.split(/\r?\n/)
  if (!terms.length || !lines.length) {
    return { contexts: [], matchCount: 0 }
  }

  type Window = { start: number; end: number; matchedTerms: Set<string> }
  const windows: Window[] = []
  let totalMatches = 0

  for (let index = 0; index < lines.length; index += 1) {
    const lowerLine = lines[index].toLowerCase()
    const matched = terms.filter((term) => lowerLine.includes(term))
    if (!matched.length) continue

    totalMatches += matched.length
    const start = Math.max(0, index - SEARCH_CONTEXT_LINES_BEFORE)
    const end = Math.min(lines.length - 1, index + SEARCH_CONTEXT_LINES_AFTER)

    let merged = false
    for (const window of windows) {
      if (start <= window.end && window.start <= end) {
        window.start = Math.min(window.start, start)
        window.end = Math.max(window.end, end)
        for (const term of matched) {
          window.matchedTerms.add(term)
        }
        merged = true
        break
      }
    }

    if (!merged) {
      windows.push({ start, end, matchedTerms: new Set(matched) })
      if (windows.length >= SEARCH_MAX_CONTEXTS) break
    }
  }

  const contexts: SearchContextSegment[] = windows.map((window) => ({
    snippet: lines.slice(window.start, window.end + 1).join('\n').trim(),
    startLine: window.start + 1,
    endLine: window.end + 1,
    matchedTerms: Array.from(window.matchedTerms),
  }))

  return { contexts, matchCount: totalMatches }
}

function applySearchFilter(
  markdown: string,
  rawQuery?: string,
): { filteredMarkdown?: string; summary: SearchSummary; warning?: string } | undefined {
  const query = sanitizeSearchQuery(rawQuery)
  if (!query) return undefined

  const terms = tokenizeSearchTerms(query)
  if (!terms.length) {
    return {
      summary: { query, terms: [], matchCount: 0, contextCount: 0, filtered: false, contexts: [] },
      warning: `search: query "${query}" did not include usable keywords`,
    }
  }

  const { contexts, matchCount } = collectSearchContexts(markdown, terms)
  const filtered = contexts.length > 0
  const summary: SearchSummary = {
    query,
    terms,
    matchCount,
    contextCount: contexts.length,
    filtered,
    contexts,
  }

  if (filtered) {
    const filteredMarkdown = contexts.map((ctx) => ctx.snippet).join('\n\n---\n\n') || markdown
    return { filteredMarkdown, summary }
  }

  return {
    summary,
    warning: `search: no matches found for "${query}"`,
  }
}

type ContentTypeMeta = {
  type?: string
  subtype?: string
}

function describeContentType(contentType: unknown, headers?: IncomingHttpHeaders): string | undefined {
  const meta = (contentType ?? undefined) as ContentTypeMeta | undefined
  if (meta?.type) {
    return meta.subtype ? `${meta.type}/${meta.subtype}` : meta.type
  }
  const headerValue = headers?.['content-type'] ?? headers?.['Content-Type']
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue
  if (typeof raw === 'string') {
    const [typePart] = raw.split(';')
    return typePart?.trim() || undefined
  }
  return undefined
}

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    fence: '```',
    hr: '---',
    bulletListMarker: '-',
  })
  service.keep(['table', 'thead', 'tbody', 'tr', 'td', 'th'])
  service.addRule('preservePreCode', {
    filter: (node: HTMLElement) => node.nodeName === 'PRE',
    replacement: (_content: string, node: HTMLElement) => {
      const textContent = node.textContent || ''
      const language = (node.getAttribute?.('data-lang') || node.getAttribute?.('lang') || '').trim()
      const fence = language ? '```' + language + '\n' : '```\n'
      return '\n' + fence + textContent.replace(/\s+$/, '') + '\n```\n'
    },
  })
  return service
}

function extractMarkdownFromCheerio($: CheerioAPI, selector: string, removalList: string[]) {
  let selection = selector === 'body' ? $('body') : $(selector)
  let selectorUsed = selector
  if (!selection || selection.length === 0) {
    selection = $('body')
    selectorUsed = 'body'
  }

  const working = selection.first().clone()
  if (!working || working.length === 0) {
    throw new Error(`Selector "${selectorUsed}" was not found in the fetched document`)
  }

  for (const removeSelector of removalList) {
    if (!removeSelector) continue
    working.find(removeSelector).remove()
    if (working.is(removeSelector)) {
      working.remove()
    }
  }

  const htmlFragment = working.toString().trim()
  if (!htmlFragment) {
    throw new Error(`Selector "${selectorUsed}" produced no content after cleanup`)
  }

  const turndown = createTurndown()
  const markdown = turndown.turndown(htmlFragment).trim()
  if (!markdown) {
    throw new Error('Markdown conversion returned an empty string')
  }

  return { markdown, markdownLength: markdown.length, selectorUsed }
}

function headersFromResponse(headers: Headers): IncomingHttpHeaders {
  const normalized: IncomingHttpHeaders = {}
  headers.forEach((value, key) => {
    const existing = normalized[key]
    if (typeof existing === 'undefined') {
      normalized[key] = value
    } else if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      normalized[key] = [existing as string, value]
    }
  })
  return normalized
}

async function runViaCrawler(params: {
  targetUrl: URL
  selector: string
  removalList: string[]
  userAgent: string
  timeoutSecs: number
}): Promise<{ result?: FetchMarkdownResult; warning?: string }> {
  let result: FetchMarkdownResult | undefined
  let warning: string | undefined

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: 1,
    maxRequestRetries: 1,
    requestHandlerTimeoutSecs: params.timeoutSecs,
    navigationTimeoutSecs: params.timeoutSecs,
    additionalMimeTypes: ['application/xhtml+xml', 'text/plain'],
    requestHandler: async ({ request, response, $, contentType }) => {
      if (!$) throw new Error('Response did not include HTML content to parse')
      const contentDescription = describeContentType(contentType, response?.headers)
      if (contentDescription && !/html|xml/i.test(contentDescription)) {
        throw new Error(`Expected HTML but received ${contentDescription}`)
      }

      const { markdown, markdownLength, selectorUsed } = extractMarkdownFromCheerio($, params.selector, params.removalList)
      result = {
        requestedUrl: params.targetUrl.toString(),
        finalUrl: request.loadedUrl || request.url,
        title: $('title').first().text().trim() || undefined,
        statusCode: response?.statusCode ?? null,
        selectorUsed,
        removedSelectors: params.removalList,
        markdown,
        markdownLength,
        fetchedAt: new Date().toISOString(),
        headers: normalizeHeaders(response?.headers),
        contentType: contentDescription,
        userAgentApplied: params.userAgent,
        timing: { elapsedMs: 0 },
      }
    },
    preNavigationHooks: [
      async ({ request }) => {
        request.headers ??= {}
        request.headers['user-agent'] = params.userAgent
        if (!request.headers['accept']) {
          request.headers['accept'] = DEFAULT_ACCEPT_HEADER
        }
      },
    ],
  })

  try {
    await crawler.run([params.targetUrl.toString()])
  } catch (err) {
    if (!result) throw err
    warning = err instanceof Error ? err.message : String(err)
  }

  return { result, warning }
}

async function runViaDirectFetch(params: {
  targetUrl: URL
  selector: string
  removalList: string[]
  userAgent: string
  timeoutMs: number
}): Promise<FetchMarkdownResult> {
  const globalFetch = globalThis.fetch
  if (typeof globalFetch !== 'function') {
    throw new Error('Global fetch() is not available in this environment')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), params.timeoutMs)
  try {
    const response = await globalFetch(params.targetUrl.toString(), {
      method: 'GET',
      headers: {
        'user-agent': params.userAgent,
        accept: DEFAULT_ACCEPT_HEADER,
      },
      redirect: 'follow',
      signal: controller.signal,
    })

    const body = await response.text()
    if (!body || !body.trim()) {
      throw new Error('Direct fetch returned an empty response body')
    }

    const headers = headersFromResponse(response.headers)
    const $ = load(body)
    const { markdown, markdownLength, selectorUsed } = extractMarkdownFromCheerio($, params.selector, params.removalList)

    return {
      requestedUrl: params.targetUrl.toString(),
      finalUrl: response.url || params.targetUrl.toString(),
      title: $('title').first().text().trim() || undefined,
      statusCode: response.status ?? null,
      selectorUsed,
      removedSelectors: params.removalList,
      markdown,
      markdownLength,
      fetchedAt: new Date().toISOString(),
      headers: normalizeHeaders(headers),
      contentType: describeContentType(undefined, headers),
      userAgentApplied: params.userAgent,
      timing: { elapsedMs: 0 },
    }
  } catch (error: any) {
    if (error && (error.name === 'AbortError' || error.code === 'ABORT_ERR')) {
      throw new Error(`Direct fetch timed out after ${params.timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export const webFetchMarkdownTool: AgentTool = {
  name: 'webFetchMarkdown',
  description:
    'Fetch an HTTP(S) URL with Crawlee\'s CheerioCrawler, clean the DOM, convert the result to Markdown, and optionally scope the output to ~50-line contexts that surround provided search keywords.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'HTTP(S) URL to fetch.' },
      selector: { type: 'string', description: 'CSS selector to scope conversion (default: body).' },
      timeoutMs: { type: 'integer', minimum: MIN_TIMEOUT_MS, maximum: MAX_TIMEOUT_MS, description: 'Maximum crawl duration in milliseconds (default 15000).' },
      userAgent: { type: 'string', description: 'Override the User-Agent header sent to the target URL.' },
      stripSelectors: { type: 'array', items: { type: 'string' }, description: 'Additional CSS selectors removed before conversion.' },
      search: {
        type: 'string',
        description:
          'Optional keyword list (space/comma separated). When provided, the tool returns only the matching snippets plus ~50 lines of Markdown before and after each match.',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  run: async (args: FetchMarkdownArgs) => {
    const start = Date.now()
    try {
      const targetUrl = validateHttpUrl(args.url)
      const selector = sanitizeSelector(args.selector)
      const timeoutMs = clampTimeout(args.timeoutMs)
      const removalList = buildRemovalList(args.stripSelectors)
      const userAgent = sanitizeUserAgent(args.userAgent)
      const timeoutSecs = Math.max(1, Math.ceil(timeoutMs / 1000))
      const failureMessages: string[] = []
      let warning: string | undefined
      let result: FetchMarkdownResult | undefined

      try {
        const crawlOutcome = await runViaCrawler({ targetUrl, selector, removalList, userAgent, timeoutSecs })
        if (crawlOutcome.result) {
          result = crawlOutcome.result
          warning = crawlOutcome.warning
        } else {
          failureMessages.push('crawler: no DOM content was captured')
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        failureMessages.push(`crawler: ${message}`)
      }

      if (!result) {
        try {
          result = await runViaDirectFetch({ targetUrl, selector, removalList, userAgent, timeoutMs })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          failureMessages.push(`directFetch: ${message}`)
        }
      }

      if (!result) {
        const detail = failureMessages.length ? ` (${failureMessages.join(' | ')})` : ''
        throw new Error(`No content was captured from the provided URL${detail}`)
      }

      const searchOutcome = applySearchFilter(result.markdown, args.search)
      if (searchOutcome) {
        result.fullMarkdownLength = result.markdownLength
        result.searchSummary = searchOutcome.summary
        if (searchOutcome.filteredMarkdown) {
          result.markdown = searchOutcome.filteredMarkdown
          result.markdownLength = result.markdown.length
        }
        if (searchOutcome.warning) {
          warning = warning ? `${warning} | ${searchOutcome.warning}` : searchOutcome.warning
        }
      }

      result.timing.elapsedMs = Date.now() - start
      if (!warning && failureMessages.length) {
        warning = failureMessages.join(' | ')
      }
      if (warning) result.warning = warning

      return { ok: true, data: result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: `webFetchMarkdown: ${message}` }
    }
  },
  toModelResult: (raw: any) => {
    if (raw?.ok && raw?.data) {
      const markdown: string = raw.data.markdown || ''
      const truncated = markdown.length > PREVIEW_LIMIT ? `${markdown.slice(0, PREVIEW_LIMIT)}…` : markdown
      const previewKey = randomUUID()
      return {
        minimal: {
          ok: true,
          url: raw.data.finalUrl || raw.data.requestedUrl,
          title: raw.data.title,
          statusCode: raw.data.statusCode,
          markdownLength: raw.data.markdownLength ?? markdown.length,
          fullMarkdownLength: raw.data.fullMarkdownLength,
          markdownPreview: truncated,
          selectorUsed: raw.data.selectorUsed,
          fetchedAt: raw.data.fetchedAt,
          searchSummary: raw.data.searchSummary,
          previewKey,
        },
        ui: raw.data,
        previewKey,
      }
    }
    return { minimal: raw }
  },
}

export default webFetchMarkdownTool
