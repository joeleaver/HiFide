import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Indexer } from '../indexing/indexer'

// Stub embedding engine to avoid native deps during tests
jest.mock('../indexing/engine', () => ({
  getLocalEngine: async () => ({
    id: 'test-embed',
    dim: 3,
    embed: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])
  })
}))


describe('Indexer - respects .gitignore (with negation)', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'indexer-gi-'))

    // Workspace layout
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true })

    // .gitignore that ignores md but re-includes keep.md
    const gi = [
      '# ignore markdown except keep.md',
      'src/*.md',
      '!src/keep.md',
      ''
    ].join('\n')
    await fs.writeFile(path.join(tmpDir, '.gitignore'), gi, 'utf-8')

    // Files
    await fs.writeFile(path.join(tmpDir, 'src', 'a.md'), 'alpha md\n'.repeat(5), 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'src', 'keep.md'), 'keep md\n'.repeat(5), 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'src', 'a.txt'), 'alpha txt\n'.repeat(5), 'utf-8')
  })

  afterAll(async () => {
    try { await fs.rm(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it('does not index gitignored files and does index negation re-includes', async () => {
    const indexer = new Indexer(tmpDir)

    await indexer.rebuild()

    // Read chunk files from .hifide-private/indexes and assert paths
    const idxDir = path.join(tmpDir, '.hifide-private', 'indexes')
    const files = await fs.readdir(idxDir)
    const chunkFiles = files.filter((f) => f.startsWith('chunks-'))

    const allChunks: Array<{ path: string }> = []
    for (const cf of chunkFiles) {
      const raw = await fs.readFile(path.join(idxDir, cf), 'utf-8')
      const arr = JSON.parse(raw)
      allChunks.push(...arr)
    }

    const paths = new Set(allChunks.map((c) => c.path))
    expect(paths.has(path.join('src', 'a.md'))).toBe(false)
    expect(paths.has(path.join('src', 'keep.md'))).toBe(true)
    expect(paths.has(path.join('src', 'a.txt'))).toBe(true)
  })
})

