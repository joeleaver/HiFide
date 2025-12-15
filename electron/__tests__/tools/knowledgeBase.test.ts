import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { knowledgeBaseStoreTool } from '../../tools/kb/store'
import { knowledgeBaseSearchTool } from '../../tools/kb/search'
import { knowledgeBaseDeleteTool } from '../../tools/kb/delete'

import { readById } from '../../store/utils/knowledgeBase'

describe('Knowledge Base tools', () => {
  let tmpDir: string
  const getMeta = () => ({ workspaceId: tmpDir })

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-tools-'))
    process.env.HIFIDE_WORKSPACE_ROOT = tmpDir
  })

  afterAll(async () => {
    try { await fs.rm(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it('creates and searches entries', async () => {
    const createRes: any = await knowledgeBaseStoreTool.run({ title: 'KB Intro', description: 'Hello KB', tags: ['intro'] }, getMeta())
    expect(createRes.ok).toBe(true)
    const id = createRes?.data?.id
    expect(typeof id).toBe('string')

    const searchRes: any = await knowledgeBaseSearchTool.run({ query: 'hello', tags: [] }, getMeta())
    expect(searchRes.ok).toBe(true)
    expect(searchRes.data.count).toBeGreaterThanOrEqual(1)
    const found = searchRes.data.results.find((r: any) => r.id === id)
    expect(found).toBeTruthy()
  })

  it('fails to create entry when description is missing', async () => {
    const res: any = await knowledgeBaseStoreTool.run({ title: 'Stub Topic' }, getMeta())
    expect(res.ok).toBe(false)
    const msg = (res.error || '').toString().toLowerCase()
    expect(msg).toContain('description')
  })

  it('normalizes JSON-escaped newlines on create', async () => {
    const createRes: any = await knowledgeBaseStoreTool.run({ title: 'Escaped NL', description: 'Line1\\nLine2' }, getMeta())
    expect(createRes.ok).toBe(true)
    const id = createRes?.data?.id
    const found = await readById(process.env.HIFIDE_WORKSPACE_ROOT || '', id)
    expect(found?.body.includes('\n')).toBe(true)
    expect(found?.body.includes('\\n')).toBe(false)
  })

  it('unwraps full-document fenced markdown', async () => {
    const fenced = '```markdown\nHello\n\nWorld\n```'
    const res: any = await knowledgeBaseStoreTool.run({ title: 'Fenced Doc', description: fenced }, getMeta())
    expect(res.ok).toBe(true)
    const id = res?.data?.id
    const found = await readById(process.env.HIFIDE_WORKSPACE_ROOT || '', id)
    expect(found?.body.startsWith('Hello')).toBe(true)
    expect(found?.body.includes('```')).toBe(false)
  })

  it('extracts trailing JSON meta (tags/files) from description and merges into front matter', async () => {
    const desc = 'Intro paragraph.\n\nDetails here.\n{\n  "tags": ["economy", "simulation"],\n  "files": ["src/systems/economy.ts", "docs/design/economy.md"]\n}'
    const res: any = await knowledgeBaseStoreTool.run({ title: 'Economy System', description: desc }, getMeta())
    expect(res.ok).toBe(true)
    const id = res?.data?.id
    const found = await readById(process.env.HIFIDE_WORKSPACE_ROOT || '', id)
    expect(found).toBeTruthy()
    // Body should not include the JSON block
    expect(found!.body.includes('"tags"')).toBe(false)
    expect(found!.body.includes('"files"')).toBe(false)
    // Meta should contain merged tags/files
    expect(Array.isArray(found!.meta.tags)).toBe(true)
    expect(found!.meta.tags).toEqual(expect.arrayContaining(['economy', 'simulation']))
    expect(Array.isArray((found!.meta as any).files)).toBe(true)
    expect((found!.meta as any).files).toEqual(expect.arrayContaining(['src/systems/economy.ts', 'docs/design/economy.md']))
  })

  it('deletes entries', async () => {
    const createRes: any = await knowledgeBaseStoreTool.run({ title: 'To Delete', description: 'Temp body' }, getMeta())
    expect(createRes.ok).toBe(true)
    const id = createRes?.data?.id
    const delRes: any = await knowledgeBaseDeleteTool.run({ id }, getMeta())
    expect(delRes.ok).toBe(true)
    const found = await readById(process.env.HIFIDE_WORKSPACE_ROOT || '', id)
    expect(found).toBeNull()
  })

  it('falls back to tokenized search and shares KB ids with the model payload', async () => {
    const zephyrRes: any = await knowledgeBaseStoreTool.run({
      title: 'Zephyr Rail Systems',
      description: 'The zephyr rail program relies on quartz housings and superconducting guides.'
    }, getMeta())
    const lumenRes: any = await knowledgeBaseStoreTool.run({
      title: 'Lumen Gulf Logistics',
      description: 'Harbor pilots maintain lumen beacons along the gulf approach.'
    }, getMeta())

    const zephyrId = zephyrRes?.data?.id
    const lumenId = lumenRes?.data?.id

    const fallbackSearch: any = await knowledgeBaseSearchTool.run({ query: 'zephyr lumen quartz', limit: 5 }, getMeta())
    expect(fallbackSearch.ok).toBe(true)
    expect(fallbackSearch.data.count).toBeGreaterThanOrEqual(2)
    const ids = fallbackSearch.data.results.map((r: any) => r.id)
    expect(ids).toEqual(expect.arrayContaining([zephyrId, lumenId]))
    expect(fallbackSearch.data.results[0].id).toBe(zephyrId)
    expect(typeof fallbackSearch.data.results[0].score).toBe('number')

    const formatted = knowledgeBaseSearchTool.toModelResult?.(fallbackSearch)
    expect(formatted?.previewKey).toBeDefined()
    expect((formatted?.minimal as any)?.previewKey).toBeUndefined()
    expect(Array.isArray((formatted?.minimal as any)?.results)).toBe(true)
    const minimalFirst = (formatted?.minimal as any)?.results?.[0]
    expect(minimalFirst?.id).toBe(zephyrId)
  })
})
