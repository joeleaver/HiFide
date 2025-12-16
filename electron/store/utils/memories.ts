import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { z } from 'zod'
import { resolveWorkspaceRootAsync } from '../../utils/workspace.js'
import type { MemoryItemType, WorkspaceMemoriesFile, WorkspaceMemoryItem } from './workspace-helpers'

export type { MemoryItemType, WorkspaceMemoriesFile, WorkspaceMemoryItem } from './workspace-helpers'

const MEMORIES_REL_PATH = path.join('.hifide-public', 'memories.json')

const MemoryItemTypeSchema = z.enum(['decision', 'constraint', 'preference', 'fact', 'warning', 'workflow'])

const WorkspaceMemoryItemSchema: z.ZodType<WorkspaceMemoryItem> = z.object({
  id: z.string().min(1),
  type: MemoryItemTypeSchema,
  text: z.string().min(1),
  tags: z.array(z.string()).default([]),
  importance: z.number().min(0).max(1),
  contentHash: z.string().min(1),
  source: z.enum(['implicit-extraction', 'user-edit', 'system']),
  enabled: z.boolean().optional().default(true),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastUsedAt: z.string().min(1).optional(),
  usageCount: z.number().int().nonnegative().optional(),
})

const WorkspaceMemoriesFileSchema: z.ZodType<WorkspaceMemoriesFile> = z.object({
  version: z.literal(1),
  items: z.array(WorkspaceMemoryItemSchema),
  settings: z.object({}).passthrough().optional(),
})

export type MemoryCandidate = {
  type: MemoryItemType
  text: string
  tags?: string[]
  importance?: number
}


export const DEFAULT_MEMORY_RULE_TOGGLES: Record<MemoryItemType, boolean> = {
  decision: true,
  constraint: true,
  preference: true,
  fact: true,
  warning: true,
  workflow: true,
}

export type ApplyCandidatesResult = {
  created: number
  updated: number
  skipped: number
}

export async function readWorkspaceMemories(workspaceId?: string): Promise<WorkspaceMemoriesFile> {
  const root = await resolveWorkspaceRootAsync(workspaceId)
  const absPath = path.join(root, MEMORIES_REL_PATH)

  try {
    const raw = await fs.readFile(absPath, 'utf8')
    const json = JSON.parse(raw)
    const parsed = WorkspaceMemoriesFileSchema.safeParse(json)
    if (parsed.success) return normalizeMemories(parsed.data)
  } catch (e: any) {
    if (e?.code !== 'ENOENT') {
      // fall through to default
    }
  }

  const empty: WorkspaceMemoriesFile = { version: 1, items: [] }
  await writeWorkspaceMemories(empty, workspaceId)
  return empty
}

export async function writeWorkspaceMemories(memories: WorkspaceMemoriesFile, workspaceId?: string): Promise<void> {
  const root = await resolveWorkspaceRootAsync(workspaceId)
  const absPath = path.join(root, MEMORIES_REL_PATH)
  await fs.mkdir(path.dirname(absPath), { recursive: true })

  const normalized = normalizeMemories(memories)
  const payload = JSON.stringify(normalized, null, 2)
  const tmpPath = `${absPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 9)}`
  await fs.writeFile(tmpPath, payload, 'utf8')
  await fs.rename(tmpPath, absPath)
}

/**
 * Removes deprecated settings keys (e.g. `settings.ruleToggles`) by rewriting the file
 * with the current normalization behavior.
 */
export async function cleanupDeprecatedMemoriesSettings(workspaceId?: string): Promise<void> {
  const store = await readWorkspaceMemories(workspaceId)
  const cleaned = normalizeMemories(store)
  const before = JSON.stringify(store.settings ?? {})
  const after = JSON.stringify(cleaned.settings ?? {})
  if (before !== after) {
    await writeWorkspaceMemories(cleaned, workspaceId)
  }
}

export async function applyMemoryCandidates(
  candidates: MemoryCandidate[],
  opts?: { workspaceId?: string; similarityThreshold?: number; ruleToggles?: Partial<Record<MemoryItemType, boolean>> }
): Promise<ApplyCandidatesResult> {
  const similarityThreshold = typeof opts?.similarityThreshold === 'number' ? opts.similarityThreshold : 0.78
  const workspaceId = opts?.workspaceId

  const store = await readWorkspaceMemories(workspaceId)

  // Extraction type gating is now configured on the extractMemories flow node.
  // We keep an optional override for future use, but do not read any store-level rule toggles.
  const toggles = { ...DEFAULT_MEMORY_RULE_TOGGLES, ...(opts?.ruleToggles || {}) }

  const now = new Date().toISOString()
  let created = 0
  let updated = 0
  let skipped = 0

  for (const candidate of candidates || []) {
    // Allow disabling extraction "rules" by memory type.
    if (candidate?.type && toggles[candidate.type] === false) {
      skipped += 1
      continue
    }

    const prepared = prepareCandidate(candidate)
    if (!prepared) {
      skipped += 1
      continue
    }

    const { type, text, tags, importance, contentHash, tokens } = prepared

    // Exact dedupe via contentHash
    const exact = store.items.find((it) => it.contentHash === contentHash)
    if (exact) {
      exact.updatedAt = now
      exact.importance = clamp01(Math.max(exact.importance, importance))
      exact.tags = mergeTags(exact.tags, tags)
      updated += 1
      continue
    }

    // Lexical similarity against all existing
    let bestIdx = -1
    let bestScore = 0
    for (let i = 0; i < store.items.length; i++) {
      const existing = store.items[i]
      const score = similarityScore({
        aTokens: tokens,
        bTokens: tokenizeForSimilarity(existing.text),
        sameType: existing.type === type,
        tagOverlap: overlapRatio(tags, existing.tags),
      })
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }

    if (bestIdx >= 0 && bestScore >= similarityThreshold) {
      const target = store.items[bestIdx]
      target.updatedAt = now
      target.tags = mergeTags(target.tags, tags)
      target.importance = clamp01(Math.max(target.importance, importance))
      // Prefer clearer/shorter when highly similar
      if (isClearerReplacement(text, target.text)) {
        target.text = text
        target.contentHash = contentHashOf(text)
      }
      updated += 1
      continue
    }

    const item: WorkspaceMemoryItem = {
      id: `mem-${crypto.randomUUID()}`,
      type,
      text,
      tags,
      importance,
      contentHash,
      source: 'implicit-extraction',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      usageCount: 0,
    }

    store.items.push(item)
    created += 1
  }

  // Keep stable ordering: newest updated last, but preserve by createdAt for now
  store.items = store.items
    .filter((it) => it && typeof it.text === 'string' && it.text.trim())
    .map((it) => ({ ...it, tags: mergeTags([], it.tags || []) }))

  await writeWorkspaceMemories(store, workspaceId)
  return { created, updated, skipped }
}

function normalizeMemories(file: WorkspaceMemoriesFile): WorkspaceMemoriesFile {
  const items = Array.isArray(file.items) ? file.items : []
  return {
    version: 1,
    items: items.map((it) => ({
      ...it,
      tags: mergeTags([], it.tags || []),
      importance: clamp01(typeof it.importance === 'number' ? it.importance : 0.5),
      enabled: typeof it.enabled === 'boolean' ? it.enabled : true,
      usageCount: typeof it.usageCount === 'number' ? it.usageCount : 0,
    })),
    // Keep settings envelope for future store-level settings, but strip deprecated keys.
    settings: stripDeprecatedMemorySettings(file.settings),
  }
}

function stripDeprecatedMemorySettings(settings: WorkspaceMemoriesFile['settings']): WorkspaceMemoriesFile['settings'] {
  if (!settings || typeof settings !== 'object') return settings
  // Remove deprecated rule toggles now that extraction types are configured per-node.
  const { ruleToggles: _ruleToggles, ...rest } = settings as any
  return rest
}

function prepareCandidate(candidate: MemoryCandidate | null | undefined): null | {
  type: MemoryItemType
  text: string
  tags: string[]
  importance: number
  contentHash: string
  tokens: string[]
} {
  if (!candidate) return null
  const type = candidate.type
  const text = String(candidate.text || '').trim()
  if (!text) return null

  // Reject overly long / log-like payloads
  if (text.length > 800) return null
  if (looksLikeLog(text)) return null

  const tags = mergeTags([], candidate.tags || [])
  const importance = clamp01(typeof candidate.importance === 'number' ? candidate.importance : 0.5)
  const contentHash = contentHashOf(text)
  const tokens = tokenizeForSimilarity(text)

  if (tokens.length < 2) return null

  return { type, text, tags, importance, contentHash, tokens }
}

function looksLikeLog(text: string): boolean {
  const lines = text.split(/\r?\n/)
  if (lines.length >= 6) return true
  if (/\bException\b|\bStack trace\b|\bat\s+\w+\(/i.test(text)) return true
  if (/\b(TRACE|DEBUG|INFO|WARN|ERROR)\b\s*[:\[]/i.test(text)) return true
  return false
}

const TOKEN_SPLIT = /[^a-z0-9]+/i
const STOP_WORDS = new Set([
  'the','and','for','with','this','that','from','into','your','you','are','was','were','have','has','had','not','but','can','will','its','our','their','about','just','only','also','than','then','when','what','how','why','should','would','could','there','here','them','they','she','him','his','her','she','been','being','over','under','within','without','via'
])

function tokenizeForSimilarity(text: string): string[] {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .split(TOKEN_SPLIT)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t))

  const seen = new Set<string>()
  const out: string[] = []
  for (const t of raw) {
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function overlapRatio(a: string[] | undefined, b: string[] | undefined): number {
  const as = new Set((a || []).map((t) => t.toLowerCase()))
  const bs = new Set((b || []).map((t) => t.toLowerCase()))
  if (as.size === 0 || bs.size === 0) return 0
  let inter = 0
  for (const t of as) if (bs.has(t)) inter++
  return inter / Math.max(as.size, bs.size)
}

function similarityScore(args: { aTokens: string[]; bTokens: string[]; sameType: boolean; tagOverlap: number }): number {
  const { aTokens, bTokens, sameType, tagOverlap } = args
  const a = new Set(aTokens)
  const b = new Set(bTokens)
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  const jaccard = union > 0 ? inter / union : 0
  const typeBoost = sameType ? 0.06 : 0
  const tagBoost = Math.min(0.08, tagOverlap * 0.08)
  return clamp01(jaccard + typeBoost + tagBoost)
}

function isClearerReplacement(next: string, prev: string): boolean {
  const a = tokenizeForSimilarity(next).length
  const b = tokenizeForSimilarity(prev).length
  if (a === 0 || b === 0) return next.length < prev.length
  // Prefer slightly shorter / less verbose
  return a <= b && next.length <= prev.length + 30
}

function mergeTags(existing: string[], incoming: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of [...(existing || []), ...(incoming || [])]) {
    const tag = String(t || '').trim().toLowerCase()
    if (!tag) continue
    if (seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}

function clamp01(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function contentHashOf(text: string): string {
  const normalized = normalizeText(text)
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

function normalizeText(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^a-z0-9\s'".-]/g, '')
}

export async function markMemoriesUsed(ids: string[], opts?: { workspaceId?: string }): Promise<void> {
  const workspaceId = opts?.workspaceId
  const uniq = Array.from(new Set((ids || []).filter(Boolean)))
  if (!uniq.length) return

  const store = await readWorkspaceMemories(workspaceId)
  const now = new Date().toISOString()
  let changed = false
  for (const id of uniq) {
    const item = store.items.find((it) => it.id === id)
    if (!item) continue
    item.lastUsedAt = now
    item.usageCount = (item.usageCount || 0) + 1
    changed = true
  }

  if (changed) {
    await writeWorkspaceMemories(store, workspaceId)
  }
}

export type MemoryRagOptions = {
  workspaceId?: string
  maxItems?: number
  maxChars?: number
  minImportance?: number
}

export async function retrieveWorkspaceMemoriesForQuery(
  query: string,
  opts?: MemoryRagOptions
): Promise<Array<WorkspaceMemoryItem>> {
  const workspaceId = opts?.workspaceId
  const maxItems = typeof opts?.maxItems === 'number' ? opts.maxItems : 8
  const maxChars = typeof opts?.maxChars === 'number' ? opts.maxChars : 2400
  const minImportance = typeof opts?.minImportance === 'number' ? opts.minImportance : 0

  const store = await readWorkspaceMemories(workspaceId)
  const qTokens = tokenizeForSimilarity(String(query || ''))
  if (!qTokens.length) return []

  const scored = store.items
    .filter((it) => it.enabled !== false)
    .filter((it) => (it.importance || 0) >= minImportance)
    .map((it) => {
      const tTokens = tokenizeForSimilarity(it.text)
      const score = similarityScore({ aTokens: qTokens, bTokens: tTokens, sameType: false, tagOverlap: 0 })
      const importanceBoost = Math.min(0.12, (it.importance || 0) * 0.12)
      const usageBoost = Math.min(0.08, Math.log10(1 + (it.usageCount || 0)) * 0.04)
      return { it, score: clamp01(score + importanceBoost + usageBoost) }
    })
    .filter((x) => x.score > 0.05)
    .sort((a, b) => b.score - a.score)

  const out: WorkspaceMemoryItem[] = []
  let chars = 0
  for (const entry of scored) {
    if (out.length >= maxItems) break
    const nextLen = entry.it.text.length
    if (chars + nextLen > maxChars) break
    out.push(entry.it)
    chars += nextLen
  }

  return out
}
