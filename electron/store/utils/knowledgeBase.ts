import path from 'node:path'
import fs from 'node:fs/promises'

export type KbMeta = {
  id: string
  title: string
  tags: string[]
  files?: string[]
  createdAt: string
  updatedAt: string
}

export type KbItem = KbMeta & {
  slug: string
  relPath: string // path relative to workspace root
}

export type KbHit = KbItem & {
  excerpt?: string
  score?: number
}

// ---------- helpers ----------

export function toSlug(input: string): string {
  const s = (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
  return s || 'untitled'
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true })
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

// Normalize inbound Markdown text to what MDXEditor expects
// - Convert CRLF/CR to LF
// - If content is a single line but contains "\\n", convert to real newlines
// - If the whole document is wrapped in a single fenced block like ```md|markdown|mdx, unwrap it
export function normalizeMarkdown(s: string): string {
  let t = String(s ?? '')
  // Normalize real line endings first
  t = t.replace(/\r\n?/g, '\n')
  // Aggressively unescape common JSON-escaped control chars
  // Note: This will intentionally convert \\n sequences into real newlines, which is
  // desired for LLM-produced descriptions.
  t = t.replace(/\\r\\n/g, '\n')
       .replace(/\\r/g, '\n')
       .replace(/\\t/g, '\t')
       .replace(/\\n/g, '\n')
  // Unwrap single full-document fenced block
  const trimmed = t.trim()
  const fenceMatch = trimmed.match(/^```(mdx?|markdown)?\n([\s\S]*)\n```$/)
  if (fenceMatch) {
    t = fenceMatch[2].trim() + '\n'
  }
  return t
}


// Extract a trailing JSON object containing only tags/files from the end of the doc
// Returns cleaned body and optional extracted arrays
export function extractTrailingMeta(s: string): { body: string; tags?: string[]; files?: string[] } {
  const out = { body: s } as { body: string; tags?: string[]; files?: string[] }
  try {
    const trimmed = s.trimEnd()
    // Find last opening curly that starts at a line boundary
    const lastNl = trimmed.lastIndexOf('\n{')
    const start = lastNl >= 0 ? lastNl + 1 : (trimmed.startsWith('{') ? 0 : -1)
    if (start >= 0) {
      const jsonText = trimmed.slice(start)
      const obj = JSON.parse(jsonText)
      const keys = Object.keys(obj)
      const onlyAllowed = keys.every((k) => k === 'tags' || k === 'files')
      const tagsArr = Array.isArray(obj?.tags) ? obj.tags.map(String) : undefined
      const filesArr = Array.isArray(obj?.files) ? obj.files.map(String) : undefined
      if (onlyAllowed && (tagsArr?.length || filesArr?.length)) {
        out.body = trimmed.slice(0, start).replace(/[\s\n]+$/, '') + '\n'
        if (tagsArr?.length) out.tags = tagsArr
        if (filesArr?.length) out.files = filesArr
      }
    }
  } catch { /* ignore */ }
  return out
}

const TOKEN_SPLIT_REGEX = /[^a-z0-9]+/i
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'you', 'are', 'was', 'were', 'have', 'has', 'had', 'not', 'but', 'can', 'will', 'its', 'our', 'their', 'about'])

function tokenizeQueryTokens(query: string): string[] {
  const rawTokens = (query || '')
    .toLowerCase()
    .split(TOKEN_SPLIT_REGEX)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t))

  const seen = new Set<string>()
  const tokens: string[] = []
  for (const token of rawTokens) {
    if (!token || seen.has(token)) continue
    seen.add(token)
    tokens.push(token)
  }
  return tokens
}

type CountResult = { count: number; firstIndex: number }

function countTokenMatches(haystack: string, needle: string): CountResult {
  if (!haystack || !needle) return { count: 0, firstIndex: -1 }
  let idx = haystack.indexOf(needle)
  if (idx === -1) return { count: 0, firstIndex: -1 }
  let count = 0
  const firstIndex = idx
  while (idx !== -1) {
    count += 1
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return { count, firstIndex }
}

function buildBodyExcerpt(body: string, index: number, matchLength: number): string {
  if (!body) return ''
  const start = Math.max(0, index - 80)
  const end = Math.min(body.length, index + matchLength + 80)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < body.length ? '…' : ''
  return `${prefix}${body.slice(start, end)}${suffix}`.trim()
}

function buildFieldExcerpt(label: string, raw: string, index: number, matchLength: number): string {
  if (!raw) return ''
  if (index >= 0) {
    const start = Math.max(0, index - 40)
    const end = Math.min(raw.length, index + matchLength + 40)
    const prefix = start > 0 ? '…' : ''
    const suffix = end < raw.length ? '…' : ''
    return `${label}: ${prefix}${raw.slice(start, end)}${suffix}`.trim()
  }
  const truncated = raw.length > 160 ? `${raw.slice(0, 160)}…` : raw
  return `${label}: ${truncated}`.trim()
}

type TokenScoreInput = {
  tokens: string[]
  titleRaw: string
  titleLower: string
  tagsRaw: string
  tagsLower: string
  filesRaw: string
  filesLower: string
  bodyRaw: string
  bodyLower: string
}

function scoreTokenMatches(ctx: TokenScoreInput): { score: number; excerpt?: string } | null {
  if (!ctx.tokens.length) return null
  let uniqueTokensMatched = 0
  let totalHits = 0
  let titleHits = 0
  let tagHits = 0
  let fileHits = 0
  let bodyHits = 0
  let excerpt: string | undefined

  for (const token of ctx.tokens) {
    let tokenMatched = false

    const titleMatch = countTokenMatches(ctx.titleLower, token)
    if (titleMatch.count > 0) {
      tokenMatched = true
      titleHits += titleMatch.count
      totalHits += titleMatch.count
      if (!excerpt && titleMatch.firstIndex >= 0) {
        excerpt = buildFieldExcerpt('Title', ctx.titleRaw, titleMatch.firstIndex, token.length)
      }
    }

    const tagsMatch = countTokenMatches(ctx.tagsLower, token)
    if (tagsMatch.count > 0) {
      tokenMatched = true
      tagHits += tagsMatch.count
      totalHits += tagsMatch.count
      if (!excerpt && tagsMatch.firstIndex >= 0) {
        excerpt = buildFieldExcerpt('Tags', ctx.tagsRaw, tagsMatch.firstIndex, token.length)
      }
    }

    const filesMatch = countTokenMatches(ctx.filesLower, token)
    if (filesMatch.count > 0) {
      tokenMatched = true
      fileHits += filesMatch.count
      totalHits += filesMatch.count
      if (!excerpt && filesMatch.firstIndex >= 0) {
        excerpt = buildFieldExcerpt('Files', ctx.filesRaw, filesMatch.firstIndex, token.length)
      }
    }

    const bodyMatch = countTokenMatches(ctx.bodyLower, token)
    if (bodyMatch.count > 0) {
      tokenMatched = true
      bodyHits += bodyMatch.count
      totalHits += bodyMatch.count
      if (!excerpt && bodyMatch.firstIndex >= 0) {
        excerpt = buildBodyExcerpt(ctx.bodyRaw, bodyMatch.firstIndex, token.length)
      }
    }

    if (tokenMatched) {
      uniqueTokensMatched += 1
    }
  }

  if (!uniqueTokensMatched) return null

  const coverageScore = uniqueTokensMatched / ctx.tokens.length
  const metadataScore = (titleHits * 2.5) + (tagHits * 1.5) + (fileHits * 1.25)
  const bodyScore = Math.min(bodyHits, 12) * 0.5
  const densityScore = totalHits * 0.15
  const score = Number(((coverageScore * 5) + metadataScore + bodyScore + densityScore).toFixed(3))

  return { score, excerpt }
}


function parseFrontMatter(text: string): { meta: Partial<KbMeta>; body: string } {
  if (!text.startsWith('---')) return { meta: {}, body: text }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { meta: {}, body: text }
  const header = text.slice(3, end).trim()
  const body = text.slice(end + 4).replace(/^\s*\n/, '')
  const meta: any = {}
  for (const line of header.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    let val = m[2]
    if (key === 'tags' || key === 'files') {
      const arr = (val || '').trim()
      if (arr.startsWith('[') && arr.endsWith(']')) {
        const inner = arr.slice(1, -1)
        meta[key] = inner.split(',').map((s) => s.trim()).filter(Boolean)
        continue
      }
      meta[key] = (val || '').split(',').map((s) => s.trim()).filter(Boolean)
      continue
    }
    meta[key] = val
  }
  if (typeof meta.tags === 'string') meta.tags = [meta.tags]
  if (!Array.isArray(meta.tags)) meta.tags = []
  if (typeof meta.files === 'string') meta.files = [meta.files]
  if (!Array.isArray(meta.files)) meta.files = []
  return { meta, body }
}

function serializeFrontMatter(meta: KbMeta, body: string): string {
  const header = [
    `id: ${meta.id}`,
    `title: ${meta.title}`,
    `tags: [${(meta.tags || []).join(', ')}]`,
    `files: [${(meta.files || []).join(', ')}]`,
    `createdAt: ${meta.createdAt}`,
    `updatedAt: ${meta.updatedAt}`,
  ].join('\n')
  return `---\n${header}\n---\n\n${body || ''}`
}

export function kbRoot(baseDir: string): string {
  return path.join(baseDir, '.hifide-public', 'kb')
}

export async function ensureKbRoot(baseDir: string): Promise<string> {
  const dir = kbRoot(baseDir)
  await ensureDir(dir)
  return dir
}

async function uniqueSlug(dir: string, base: string): Promise<string> {
  let slug = base
  let i = 1
  while (await pathExists(path.join(dir, `${slug}.md`))) {
    i++
    slug = `${base}-${i}`
  }
  return slug
}

export async function listItems(baseDir: string): Promise<KbItem[]> {
  const dir = await ensureKbRoot(baseDir)
  const entries = await fs.readdir(dir).catch(() => [])
  const items: KbItem[] = []
  for (const name of entries.sort()) {
    if (!name.endsWith('.md')) continue
    const abs = path.join(dir, name)
    const relPath = path.relative(baseDir, abs)
    try {
      const text = await fs.readFile(abs, 'utf-8')
      const { meta } = parseFrontMatter(text)
      if (meta && meta.id && meta.title) {
        items.push({
          id: String(meta.id),
          title: String(meta.title),
          tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
          files: Array.isArray((meta as any).files) ? (meta as any).files.map(String) : [],
          createdAt: String(meta.createdAt || ''),
          updatedAt: String(meta.updatedAt || ''),
          slug: name.replace(/\.md$/, ''),
          relPath,
        })
      }
    } catch {}
  }
  return items
}

export async function readById(baseDir: string, id: string): Promise<{ meta: KbMeta; body: string; absPath: string } | null> {
  const dir = await ensureKbRoot(baseDir)
  const files = await fs.readdir(dir).catch(() => [])
  for (const name of files) {
    if (!name.endsWith('.md')) continue
    const abs = path.join(dir, name)
    try {
      const text = await fs.readFile(abs, 'utf-8')
      const { meta, body } = parseFrontMatter(text)
      if (String(meta.id) === id) {
        const m: KbMeta = {
          id: String(meta.id),
          title: String(meta.title || ''),
          tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
          files: Array.isArray((meta as any).files) ? (meta as any).files.map(String) : [],
          createdAt: String(meta.createdAt || new Date().toISOString()),
          updatedAt: String(meta.updatedAt || new Date().toISOString()),
        }
        return { meta: m, body, absPath: abs }
      }
    } catch {}
  }
  return null
}

export async function createItem(baseDir: string, params: { title: string; description: string; tags?: string[]; files?: string[] }): Promise<KbItem> {
  const dir = await ensureKbRoot(baseDir)
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const updatedAt = createdAt
  const base = toSlug(params.title)
  const slug = await uniqueSlug(dir, base)
  const abs = path.join(dir, `${slug}.md`)
  // Normalize and extract trailing meta (tags/files) from description
  const norm = normalizeMarkdown(params.description || '')
  const extra = extractTrailingMeta(norm)

  const tagsMerged = Array.from(new Set([...(params.tags || []), ...(extra.tags || [])]
    .map((t) => String(t).trim()).filter(Boolean)))
  const filesMerged = Array.from(new Set([...(params.files || []), ...(extra.files || [])]
    .map((f) => String(f).trim()).filter(Boolean)))

  const meta: KbMeta = {
    id,
    title: params.title,
    tags: tagsMerged,
    files: filesMerged,
    createdAt,
    updatedAt
  }
  const content = serializeFrontMatter(meta, extra.body)
  await fs.writeFile(abs, content, 'utf-8')
  const relPath = path.relative(baseDir, abs)
  return { ...meta, slug, relPath }
}

export async function updateItem(baseDir: string, params: { id: string; patch: Partial<{ title: string; description: string; tags: string[]; files: string[] }> }): Promise<KbItem | null> {
  const found = await readById(baseDir, params.id)
  if (!found) return null
  const { meta, body, absPath } = found
  const dir = path.dirname(absPath)

  // Normalize new body (or existing) and extract trailing meta
  const descProvided = params.patch.description !== undefined
  const normalizedDesc = descProvided ? normalizeMarkdown(params.patch.description as string) : normalizeMarkdown(body)
  const extra = extractTrailingMeta(normalizedDesc)

  // Merge tags/files from patch or existing meta with extracted JSON
  const baseTags = params.patch.tags ? params.patch.tags : meta.tags
  const baseFiles = params.patch.files ? params.patch.files : (meta.files || [])
  const mergedTags = Array.from(new Set([...(baseTags || []), ...(extra.tags || [])]
    .map((t) => String(t).trim()).filter(Boolean)))
  const mergedFiles = Array.from(new Set([...(baseFiles || []), ...(extra.files || [])]
    .map((f) => String(f).trim()).filter(Boolean)))

  const nextMeta: KbMeta = {
    ...meta,
    title: params.patch.title ?? meta.title,
    tags: mergedTags,
    files: mergedFiles,
    updatedAt: new Date().toISOString(),
  }
  const nextBody = extra.body

  // Handle rename on title change (slug change)
  const oldSlug = path.basename(absPath, '.md')
  const newBase = toSlug(nextMeta.title)
  let targetPath = absPath
  let slug = oldSlug
  if (newBase !== oldSlug) {
    const unique = await uniqueSlug(dir, newBase)
    targetPath = path.join(dir, `${unique}.md`)
    slug = unique
  }

  await fs.writeFile(targetPath, serializeFrontMatter(nextMeta, nextBody), 'utf-8')
  if (targetPath !== absPath) {
    // Remove old file if different
    try { await fs.unlink(absPath) } catch {}
  }

  return { ...nextMeta, slug, relPath: path.relative(baseDir, targetPath) }
}

export async function deleteItem(baseDir: string, id: string): Promise<boolean> {
  const found = await readById(baseDir, id)
  if (!found) return false
  try { await fs.unlink(found.absPath); return true } catch { return false }
}

export async function search(baseDir: string, params: { query?: string; tags?: string[]; limit?: number }): Promise<KbHit[]> {
  const { query, tags, limit = 50 } = params || {}
  const q = (query || '').toLowerCase().trim()
  const tagSet = new Set((tags || []).map((t) => t.toLowerCase()))
  const tokens = tokenizeQueryTokens(q)
  const dir = await ensureKbRoot(baseDir)
  const entries = await fs.readdir(dir).catch(() => [])
  const out: KbHit[] = []
  const fallbackCandidates: Array<{ item: KbItem; excerpt?: string; score: number }> = []

  for (const name of entries.sort()) {
    if (!name.endsWith('.md')) continue
    const abs = path.join(dir, name)
    const relPath = path.relative(baseDir, abs)
    let text = ''
    try { text = await fs.readFile(abs, 'utf-8') } catch { continue }
    const { meta, body } = parseFrontMatter(text)
    if (!meta?.id || !meta?.title) continue

    const item: KbItem = {
      id: String(meta.id),
      title: String(meta.title),
      tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
      files: Array.isArray((meta as any).files) ? (meta as any).files.map(String) : [],
      createdAt: String(meta.createdAt || ''),
      updatedAt: String(meta.updatedAt || ''),
      slug: name.replace(/\.md$/, ''),
      relPath,
    }

    // Tag filter: require all provided tags
    const lcTags = new Set(item.tags.map((t) => t.toLowerCase()))
    let tagsOk = true
    for (const t of tagSet) { if (!lcTags.has(t)) { tagsOk = false; break } }
    if (!tagsOk) continue

    // Text match
    if (!q) {
      out.push(item)
      if (out.length >= limit) break
      continue
    }

    const titleRaw = item.title || ''
    const tagsRaw = item.tags.join(', ')
    const filesRaw = (item.files || []).join(', ')
    const bodyRaw = body || ''

    const titleLower = titleRaw.toLowerCase()
    const tagsLower = tagsRaw.toLowerCase()
    const filesLower = filesRaw.toLowerCase()
    const bodyLower = bodyRaw.toLowerCase()

    let matched = false
    let excerpt: string | undefined

    const titleIdx = titleLower.indexOf(q)
    if (titleIdx !== -1) {
      matched = true
      excerpt = buildFieldExcerpt('Title', titleRaw, titleIdx, q.length)
    }

    if (!matched) {
      const tagsIdx = tagsLower.indexOf(q)
      if (tagsIdx !== -1) {
        matched = true
        excerpt = buildFieldExcerpt('Tags', tagsRaw, tagsIdx, q.length)
      }
    }

    if (!matched) {
      const filesIdx = filesLower.indexOf(q)
      if (filesIdx !== -1) {
        matched = true
        excerpt = buildFieldExcerpt('Files', filesRaw, filesIdx, q.length)
      }
    }

    if (!matched) {
      const bodyIdx = bodyLower.indexOf(q)
      if (bodyIdx !== -1) {
        matched = true
        excerpt = buildBodyExcerpt(bodyRaw, bodyIdx, q.length)
      }
    }

    if (matched) {
      out.push({ ...item, excerpt, score: 1 })
      if (out.length >= limit) break
      continue
    }

    if (tokens.length) {
      const scored = scoreTokenMatches({
        tokens,
        titleRaw,
        titleLower,
        tagsRaw,
        tagsLower,
        filesRaw,
        filesLower,
        bodyRaw,
        bodyLower,
      })
      if (scored) {
        fallbackCandidates.push({ item, excerpt: scored.excerpt, score: scored.score })
      }
    }
  }

  if (out.length > 0 || tokens.length === 0) {
    return out
  }

  fallbackCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.item.title.localeCompare(b.item.title)
  })

  return fallbackCandidates.slice(0, limit).map(({ item, excerpt, score }) => ({
    ...item,
    excerpt,
    score
  }))
}

