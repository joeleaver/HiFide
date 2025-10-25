import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ensureKbRoot, createItem, listItems, updateItem, deleteItem, search } from '../store/utils/knowledgeBase'

describe('Knowledge Base service', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-service-'))
    process.env.HIFIDE_WORKSPACE_ROOT = tmpDir
    await ensureKbRoot(tmpDir)
  })

  afterAll(async () => {
    try { await fs.rm(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it('creates, lists, updates, searches, and deletes KB items', async () => {
    const a = await createItem(tmpDir, { title: 'Project Guidelines', description: 'Use TypeScript.\nPrefer Mantine.', tags: ['docs', 'guidelines'] })
    const b = await createItem(tmpDir, { title: 'Build Steps', description: 'pnpm i\npnpm dev', tags: ['build'] })

    const items = await listItems(tmpDir)
    expect(items.map(i => i.title).sort()).toEqual(['Build Steps', 'Project Guidelines'])

    const upd = await updateItem(tmpDir, { id: a.id, patch: { title: 'Engineering Guidelines', tags: ['docs'] } })
    expect(upd?.title).toBe('Engineering Guidelines')

    const res = await search(tmpDir, { query: 'pnpm', tags: [] })
    expect(res.find(r => r.id === b.id)).toBeTruthy()

    const ok = await deleteItem(tmpDir, a.id)
    expect(ok).toBe(true)
    const items2 = await listItems(tmpDir)
    expect(items2.find(i => i.id === a.id)).toBeFalsy()
  })
})

