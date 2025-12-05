import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { applyEditsPayload } from '../../tools/edits/applySmartEngine'

describe('applyEdits OpenAI patch parsing', () => {
  let workspace: string
  const relPath = 'openai-patch-test.txt'
  const filePath = () => path.join(workspace, relPath)

  beforeAll(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'apply-edits-openai-'))
    process.env.HIFIDE_WORKSPACE_ROOT = workspace
  })

  afterAll(async () => {
    try {
      await fs.rm(workspace, { recursive: true, force: true })
    } catch {}
  })

  beforeEach(async () => {
    await fs.mkdir(workspace, { recursive: true })
    await fs.writeFile(filePath(), ['Original line 1', 'Original line 2', 'Original line 3', ''].join('\n'), 'utf-8')
  })

  it('applies minimal OpenAI patch without an explicit end marker', async () => {
    const payload = [
      '*** Begin Patch',
      `*** Update File: ${relPath}`,
      '@@',
      '-Original line 2',
      '+Modified line 2'
    ].join('\n')

    const result = await applyEditsPayload(payload, workspace)

    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)

    const content = await fs.readFile(filePath(), 'utf-8')
    expect(content).toBe(['Original line 1', 'Modified line 2', 'Original line 3', ''].join('\n'))
  })

  it('handles context lines without prefixes between OpenAI patch hunks', async () => {
    const payload = [
      '*** Begin Patch',
      `*** Update File: ${relPath}`,
      '@@',
      'Original line 1',
      '-Original line 2',
      '+Modified line 2',
      'Original line 3',
      '*** End Patch'
    ].join('\n')

    const result = await applyEditsPayload(payload, workspace)

    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)

    const content = await fs.readFile(filePath(), 'utf-8')
    expect(content).toBe(['Original line 1', 'Modified line 2', 'Original line 3', ''].join('\n'))
  })

  it('modifies simple text files exactly like the reported reproduction', async () => {
    await fs.writeFile(filePath(), ['Line 1', 'Line 2', 'Line 3'].join('\n'), 'utf-8')

    const payload = [
      '*** Begin Patch',
      `*** Update File: ${relPath}`,
      '@@',
      '-Line 2',
      '+Modified Line 2'
    ].join('\n')

    const result = await applyEditsPayload(payload, workspace)

    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)

    const content = await fs.readFile(filePath(), 'utf-8')
    expect(content).toBe(['Line 1', 'Modified Line 2', 'Line 3'].join('\n'))
  })

  it('ignores non-breaking and zero-width characters in OpenAI patch payloads', async () => {
    await fs.writeFile(filePath(), ['Line 1', 'Line 2', 'Line 3'].join('\n'), 'utf-8')

    const payload = [
      '*** Begin Patch',
      `*** Update File: ${relPath}`,
      '@@',
      '-Line\u00a0\u200b2',
      '+Line 2 updated'
    ].join('\n')

    const result = await applyEditsPayload(payload, workspace)

    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)

    const content = await fs.readFile(filePath(), 'utf-8')
    expect(content).toBe(['Line 1', 'Line 2 updated', 'Line 3'].join('\n'))
  })
})
