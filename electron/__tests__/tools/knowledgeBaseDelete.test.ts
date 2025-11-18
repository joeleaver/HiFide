import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { knowledgeBaseDeleteTool } from '../../tools/kb/delete'
import { createItem, readById } from '../../store/utils/knowledgeBase'

describe('Knowledge Base delete tool', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-tools-del-'))
    process.env.HIFIDE_WORKSPACE_ROOT = tmpDir
  })

  afterAll(async () => {
    try { await fs.rm(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it('deletes a created entry', async () => {
    const item = await createItem(tmpDir, { title: 'To Remove', description: 'Goodbye' })
    // Sanity check exists
    const before = await readById(tmpDir, item.id)
    expect(before).not.toBeNull()

    const res: any = await knowledgeBaseDeleteTool.run({ id: item.id })
    expect(res.ok).toBe(true)

    const after = await readById(tmpDir, item.id)
    expect(after).toBeNull()
  })
})

