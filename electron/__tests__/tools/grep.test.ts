import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { grepTool } from '../../tools/text/grep'

describe('text.grep tool', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grep-tool-'))

    // Set workspace root via env to avoid importing main store in tests
    process.env.HIFIDE_WORKSPACE_ROOT = tmpDir
    process.env.DEBUG_GREP = '1'

    // Create files (ensure deterministic ordering: a.txt, b.md, c.txt)
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'src', 'a.txt'), 'Hello world\nAlpha bravo\ncharlie\n', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'src', 'b.md'), '# Title\nhello Mars\n', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'src', 'c.txt'), 'hello again\n', 'utf-8')
    // Binary file (png signature)
    await fs.writeFile(path.join(tmpDir, 'src', 'img.png'), Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A]))
  })

  afterAll(async () => {
    // Best effort cleanup
    try { await fs.rm(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it('finds matches with context and skips binary files', async () => {
    const res: any = await grepTool.run({
      pattern: 'hello',
      files: ['src/**/*.*'],
      options: { ignoreCase: true, lineNumbers: true, context: 1 }
    })

    expect(res.ok).toBe(true)
    const data = res.data
    expect(Array.isArray(data.matches)).toBe(true)
    // Should not include img.png
    for (const m of data.matches) {
      expect(m.file.endsWith('img.png')).toBe(false)
    }

    // Expect at least two matches (a.txt and b.md)
    const files = new Set(data.matches.map((m: any) => m.file))
    expect(files.has(path.join('src', 'a.txt'))).toBe(true)
    expect(files.has(path.join('src', 'b.md'))).toBe(true)

    // Check one match structure
    const anyMatch = data.matches.find((m: any) => m.file.endsWith('a.txt'))
    expect(anyMatch).toBeTruthy()
    expect(anyMatch.lineNumber).toBeGreaterThan(0)
    expect(typeof anyMatch.line).toBe('string')
    expect(Array.isArray(anyMatch.before) || anyMatch.before === undefined).toBe(true)
    expect(Array.isArray(anyMatch.after) || anyMatch.after === undefined).toBe(true)
  })

  it('supports filenamesOnly mode', async () => {
    const res: any = await grepTool.run({
      pattern: 'alpha',
      files: ['src/**/*.*'],
      options: { filenamesOnly: true, ignoreCase: true }
    })
    expect(res.ok).toBe(true)
    const { matches } = res.data
    // Only file entries without line data
    expect(matches.some((m: any) => m.file.endsWith('a.txt'))).toBe(true)
    expect(matches.every((m: any) => m.line === undefined)).toBe(true)
  })

  it('paginates with nextCursor across files', async () => {
    const first: any = await grepTool.run({
      pattern: 'hello',
      files: ['src/**/*.*'],
      options: { ignoreCase: true, maxResults: 1, lineNumbers: true }
    })
    expect(first.ok).toBe(true)
    const next = first.data.nextCursor
    expect(typeof next === 'string' && next.length > 0).toBe(true)

    const second: any = await grepTool.run({
      pattern: 'hello',
      files: ['src/**/*.*'],
      options: { ignoreCase: true, maxResults: 2, cursor: next, lineNumbers: true }
    })
    expect(second.ok).toBe(true)
    const files = new Set(second.data.matches.map((m: any) => m.file))
    expect(files.has(path.join('src', 'b.md')) || files.has(path.join('src', 'c.txt'))).toBe(true)
  })

})
