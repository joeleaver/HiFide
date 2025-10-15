import * as fs from 'fs/promises'
import * as path from 'path'

export type FlowSummary = { id: string; label: string; location: 'builtin' | 'workspace'; path: string }

const DEFAULTS_DIR = path.resolve(process.cwd(), 'electron/app/flows/defaults')

export async function listFlows(): Promise<FlowSummary[]> {
  const out: FlowSummary[] = []
  try {
    const entries = await fs.readdir(DEFAULTS_DIR)
    for (const name of entries) {
      if (name.endsWith('.json')) {
        const p = path.join(DEFAULTS_DIR, name)
        try {
          const raw = JSON.parse(await fs.readFile(p, 'utf8'))
          out.push({ id: raw.id || path.basename(name, '.json'), label: raw.label || raw.id || name, location: 'builtin', path: p })
        } catch {}
      }
    }
  } catch {}
  return out
}

import type { FlowDefinition } from './types'

export async function loadFlow(idOrPath: string): Promise<{ ok: boolean; def?: FlowDefinition; error?: string }> {
  try {
    let p = idOrPath
    if (!idOrPath.includes(path.sep)) {
      p = path.join(DEFAULTS_DIR, `${idOrPath}.json`)
    }
    const def = JSON.parse(await fs.readFile(p, 'utf8'))
    return { ok: true, def }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

export async function saveFlow(id: string, def: FlowDefinition): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const p = path.join(DEFAULTS_DIR, `${id}.json`)
    await fs.writeFile(p, JSON.stringify(def, null, 2), 'utf8')
    return { ok: true, path: p }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

