import path from 'node:path'
import { parseGitStatusPorcelain } from '../utils/gitStatusParser'

describe('parseGitStatusPorcelain', () => {
  const workspaceRoot = path.resolve('/tmp/hifide-workspace')

  it('parses modified files', () => {
    const entries = parseGitStatusPorcelain(' M src/app.ts\u0000', workspaceRoot)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      relativePath: 'src/app.ts',
      category: 'modified',
      staged: false,
      unstaged: true,
    })
    expect(entries[0].path).toBe(path.resolve(workspaceRoot, 'src/app.ts'))
  })

  it('parses untracked files', () => {
    const entries = parseGitStatusPorcelain('?? README.md\u0000', workspaceRoot)
    expect(entries[0]).toMatchObject({ category: 'untracked', staged: false, unstaged: false })
  })

  it('parses rename pairs', () => {
    const payload = 'R  src/old.ts\u0000src/new.ts\u0000'
    const entries = parseGitStatusPorcelain(payload, workspaceRoot)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      category: 'renamed',
      renameFrom: 'src/old.ts',
      relativePath: 'src/new.ts',
    })
  })
})
