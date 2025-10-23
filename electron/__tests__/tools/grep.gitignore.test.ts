import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { grepTool } from '../../tools/text/grep'

describe('text.grep tool - .gitignore semantics', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grep-gi-'))
    process.env.HIFIDE_WORKSPACE_ROOT = tmpDir

    // Write .gitignore with a negation
    // Ignore all md files under src/, but re-include src/keep.md
    const gi = [
      '# ignore markdown except keep.md',
      'src/*.md',
      '!src/keep.md',
      ''
    ].join('\n')
    await fs.writeFile(path.join(tmpDir, '.gitignore'), gi, 'utf-8')

    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'src', 'a.md'), 'hello md a\n', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'src', 'keep.md'), 'hello md keep\n', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'src', 'a.txt'), 'hello txt a\n', 'utf-8')
  })

  afterAll(async () => {
    try { await fs.rm(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it('honors negations in .gitignore', async () => {
    const res: any = await grepTool.run({
      pattern: 'hello',
      files: ['src/**/*.*'],
      options: { ignoreCase: true, filenamesOnly: true }
    })
    expect(res.ok).toBe(true)
    const files = new Set(res.data.matches.map((m: any) => m.file))

    // src/a.md is ignored by gitignore
    expect(files.has(path.join('src', 'a.md'))).toBe(false)

    // src/keep.md is re-included by the negation
    expect(files.has(path.join('src', 'keep.md'))).toBe(true)

    // .txt unaffected
    expect(files.has(path.join('src', 'a.txt'))).toBe(true)
  })
})

