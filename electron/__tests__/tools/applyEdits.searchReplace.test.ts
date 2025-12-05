import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { applyEditsPayload } from '../../tools/edits/applySmartEngine'

describe('applyEdits search/replace parsing', () => {
  let workspace: string
  const relPath = 'fixture.ts'
  const filePath = () => path.join(workspace, relPath)

  beforeAll(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'apply-edits-'))
    process.env.HIFIDE_WORKSPACE_ROOT = workspace
  })

  afterAll(async () => {
    try {
      await fs.rm(workspace, { recursive: true, force: true })
    } catch {}
  })

  beforeEach(async () => {
    await fs.mkdir(workspace, { recursive: true })
    await fs.writeFile(filePath(), 'const flag = true;\n', 'utf-8')
  })

  it('applies well-formed search/replace blocks', async () => {
    const payload = [
      'File: fixture.ts',
      '<<<<<<< SEARCH',
      'const flag = true;',
      '=======',
      'const flag = false;',
      '>>>>>>> REPLACE'
    ].join('\n')

    const result = await applyEditsPayload(payload, workspace)

    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)

    const content = await fs.readFile(filePath(), 'utf-8')
    expect(content).toBe('const flag = false;\n')
  })

  it('rejects payloads with missing terminators and leaves files untouched', async () => {
    const payload = [
      'File: fixture.ts',
      '<<<<<<< SEARCH',
      'const flag = true;',
      '=======',
      'const flag = false;',
      '// The closing delimiter is intentionally missing below',
      'File: metadata.ts',
      '<<<<<<< SEARCH',
      'noop'
    ].join('\n')

    const result = await applyEditsPayload(payload, workspace)

    expect(result.ok).toBe(false)
    expect(result.applied).toBe(0)
    expect(result.error).toMatch(/malformed-search-replace/i)

    const content = await fs.readFile(filePath(), 'utf-8')
    expect(content).toBe('const flag = true;\n')
  })

  it('applies the reported Line 2 example using search/replace format', async () => {
    const reproRelPath = 'bug-report-test.txt'
    const reproPath = path.join(workspace, reproRelPath)
    await fs.writeFile(reproPath, ['Line 1', 'Line 2', 'Line 3'].join('\n'), 'utf-8')

    const payload = [
      'File: bug-report-test.txt',
      '<<<<<<< SEARCH',
      'Line 2',
      '=======',
      'Modified Line 2',
      '>>>>>>> REPLACE'
    ].join('\n')

    const result = await applyEditsPayload(payload, workspace)

    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)

    const content = await fs.readFile(reproPath, 'utf-8')
    expect(content).toBe(['Line 1', 'Modified Line 2', 'Line 3'].join('\n'))
  })

  it('matches search text that contains non-breaking or zero-width spaces', async () => {
    const reproRelPath = 'bug-report-nbsp.txt'
    const reproPath = path.join(workspace, reproRelPath)
    await fs.writeFile(reproPath, ['Line 1', 'Line 2', 'Line 3'].join('\n'), 'utf-8')

    const payload = [
      'File: bug-report-nbsp.txt',
      '<<<<<<< SEARCH',
      'Line\u00a0\u200b2',
      '=======',
      'Line 2 updated',
      '>>>>>>> REPLACE'
    ].join('\n')

    const result = await applyEditsPayload(payload, workspace)

    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)

    const content = await fs.readFile(reproPath, 'utf-8')
    expect(content).toBe(['Line 1', 'Line 2 updated', 'Line 3'].join('\n'))
  })
})
