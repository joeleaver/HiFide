import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

import { replaceConsoleLevelTool } from '../../../../tools/code/replaceConsoleLevel'
import { replaceCallTool } from '../../../../tools/code/replaceCall'

// Directly import helper from the store mock
const { __setWorkspaceRoot } = require('../../../../__mocks__/store-index.js')

describe('AST wrapper tools (real)', () => {
  let tmp: string

  beforeEach(async () => {
    const osTmp = os.tmpdir()
    tmp = path.join(osTmp, `astwrap-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await fs.mkdir(tmp, { recursive: true })
    __setWorkspaceRoot(tmp)
  })

  afterEach(async () => {
    try { await fs.rm(tmp, { recursive: true, force: true }) } catch {}
  })

  test('replace_console_level replaces console.log to console.debug', async () => {
    const file = path.join(tmp, 'code.ts')
    await fs.writeFile(file, 'function x(){ console.log("a"); }', 'utf-8')

    const res = await replaceConsoleLevelTool.run({ fromLevel: 'log', toLevel: 'debug', languages: ['ts'], includeGlobs: ['**/*.ts'] } as any)
    expect(res?.ok).toBe(true)

    const next = await fs.readFile(file, 'utf-8')
    expect(next.includes('console.debug(')).toBe(true)
  })

  test('replace_call replaces console.log to console.debug', async () => {
    const file = path.join(tmp, 'code2.ts')
    await fs.writeFile(file, 'export function demo(){ console.log(1, 2) }', 'utf-8')

    const res = await replaceCallTool.run({ callee: 'console.log', newCallee: 'console.debug', languages: ['ts'], includeGlobs: ['**/*.ts'], cwd: tmp } as any)
    expect(res?.ok).toBe(true)

    const next = await fs.readFile(file, 'utf-8')
    expect(next.includes('console.debug(')).toBe(true)
  })
})

