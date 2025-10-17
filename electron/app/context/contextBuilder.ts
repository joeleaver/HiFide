import fs from 'node:fs/promises'
import path from 'node:path'
import { Indexer } from '../../indexing/indexer'

let indexer: Indexer | null = null
function getIndexer(): Indexer {
  const { useMainStore } = require('../../store/index.js')
  if (!indexer) indexer = new Indexer(useMainStore.getState().workspaceRoot || process.cwd())
  return indexer
}

async function pathExists(p: string) {
  try { await fs.access(p); return true } catch { return false }
}

export async function buildContextMessages(query: string, k: number = 6): Promise<Array<{ role: 'user'; content: string }>> {
  const out: Array<{ role: 'user'; content: string }> = []
  try {
    const { useMainStore } = require('../../store/index.js')
    const baseDir = path.resolve(useMainStore.getState().workspaceRoot || process.cwd())
    const contextMd = path.join(baseDir, '.hifide-public', 'context.md')
    if (await pathExists(contextMd)) {
      const projectContext = await fs.readFile(contextMd, 'utf-8')
      out.push({ role: 'user', content: `Project Context:\n\n${projectContext}` })
    }
  } catch {}

  try {
    const q = (query || '').slice(0, 2000)
    if (q) {
      const res = await getIndexer().search(q, k)
      if (res?.chunks?.length) {
        const ctx = res.chunks.map((c: any) => `• ${c.path}:${c.startLine}-${c.endLine}\n${(c.text||'').slice(0, 600)}`).join('\n\n')
        out.push({ role: 'user', content: `Relevant code from repository:\n\n${ctx}` })
      }
    }
  } catch {}

  return out
}

