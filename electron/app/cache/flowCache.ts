import * as fs from 'fs/promises'
import * as path from 'path'

export type CacheEntry = {
  key: string
  value: string
  createdAt: number
  ttlMs: number
}

const PRIV_DIR = path.resolve(process.cwd(), '.hifide-private')
const CACHE_FILE = path.join(PRIV_DIR, 'flow-cache.json')

let inited = false
let cache = new Map<string, CacheEntry>()

async function ensureDir() {
  try { await fs.mkdir(PRIV_DIR, { recursive: true }) } catch {}
}

async function readJsonSafe(file: string): Promise<any | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return null }
}

async function writeJsonSafe(file: string, obj: any): Promise<void> {
  try { await fs.writeFile(file, JSON.stringify(obj, null, 2), 'utf8') } catch {}
}

export async function initCache(): Promise<void> {
  if (inited) return
  await ensureDir()
  const raw = await readJsonSafe(CACHE_FILE)
  if (raw && Array.isArray(raw.entries)) {
    const now = Date.now()
    for (const e of raw.entries as CacheEntry[]) {
      if (!e || typeof e.key !== 'string') continue
      if (typeof e.ttlMs !== 'number' || typeof e.createdAt !== 'number') continue
      if (now <= e.createdAt + e.ttlMs) cache.set(e.key, e)
    }
  }
  inited = true
}

export async function pruneExpired(): Promise<void> {
  await initCache()
  const now = Date.now()
  let changed = false
  for (const [k, e] of cache) {
    if (now > e.createdAt + e.ttlMs) { cache.delete(k); changed = true }
  }
  if (changed) await persist()
}

export async function persist(): Promise<void> {
  await ensureDir()
  const entries = Array.from(cache.values())
  await writeJsonSafe(CACHE_FILE, { entries })
}

export async function get(key: string): Promise<string | undefined> {
  await initCache()
  const e = cache.get(key)
  if (!e) return undefined
  if (Date.now() > e.createdAt + e.ttlMs) {
    cache.delete(key)
    await persist()
    return undefined
  }
  return e.value
}

export async function set(key: string, value: string, ttlMs: number): Promise<void> {
  await initCache()
  cache.set(key, { key, value, createdAt: Date.now(), ttlMs })
  await persist()
}

export async function clear(): Promise<void> {
  await initCache()
  cache.clear()
  await persist()
}

export async function stats(): Promise<{ entries: number; bytes: number }> {
  await initCache()
  const entries = cache.size
  let bytes = 0
  try {
    const st = await fs.stat(CACHE_FILE)
    bytes = st.size
  } catch {}
  return { entries, bytes }
}

