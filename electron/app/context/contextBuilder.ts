import fs from 'node:fs/promises'
import path from 'node:path'
import { Indexer } from '../../indexing/indexer'

let indexer: Indexer | null = null
async function getIndexer(): Promise<Indexer> {
  const { ServiceRegistry } = await import('../../services/base/ServiceRegistry.js')
  const workspaceService = ServiceRegistry.get<any>('workspace')
  if (!indexer) indexer = new Indexer(workspaceService?.getWorkspaceRoot() || process.cwd())
  return indexer
}

async function pathExists(p: string) {
  try { await fs.access(p); return true } catch { return false }
}

export async function buildContextMessages(query: string, k: number = 6): Promise<Array<{ role: 'user'; content: string }>> {
  const out: Array<{ role: 'user'; content: string }> = []
  try {
    const { ServiceRegistry } = require('../../services/base/ServiceRegistry.js')
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const baseDir = path.resolve(workspaceService?.getWorkspaceRoot() || process.cwd())
    const contextMd = path.join(baseDir, '.hifide-public', 'context.md')
    if (await pathExists(contextMd)) {
      const projectContext = await fs.readFile(contextMd, 'utf-8')
      out.push({ role: 'user', content: `Project Context:\n\n${projectContext}` })
    }
  } catch {}

  try {
    const q = (query || '').slice(0, 2000)
    if (q) {
      const indexer = await getIndexer()
      const res = await indexer.search(q, k)
      if (res?.chunks?.length) {
        const ctx = res.chunks.map((c: any) => `• ${c.path}:${c.startLine}-${c.endLine}\n${(c.text||'').slice(0, 600)}`).join('\n\n')
        out.push({ role: 'user', content: `Relevant code from repository:\n\n${ctx}` })
      }
    }
  } catch {}

  return out
}

