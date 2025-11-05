/**
 * LLM Request Node - Real behavior tests for fs.*, edits.apply, code.*
 *
 * Uses a mock provider to deterministically call the provided tool, but runs the
 * real tool implementations against an isolated temporary workspace.
 */

import fs from 'node:fs/promises'
import fssync from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { ProviderAdapter, AgentTool } from '../../../../providers/provider'
import { llmRequestNode } from '../llmRequest'
import { createMainFlowContext, createMockFlowAPI, createMockNodeInputs, createTestConfig } from '../../../../__tests__/utils/testHelpers'

// Mock sendFlowEvent since we don't have WebContents in tests
jest.mock('../../events', () => ({
  sendFlowEvent: jest.fn()
}))

// Install a mock provider registry for llm-service
jest.mock('../../../../core/state', () => {
  // Minimal tool-calling mock provider that forwards to the provided tool
  const MockProvider: ProviderAdapter = {
    id: 'mock',
    async agentStream({ tools, onChunk, onDone, onError, onToolStart, onToolEnd, toolMeta }) {
      try {
        const tool = tools?.[0]
        if (!tool) throw new Error('No tool provided')
        const args = undefined as any // wrapper tools ignore this and forward their own args
        onToolStart?.({ name: tool.name, arguments: args })
        const result = await tool.run(args, toolMeta)
        onToolEnd?.({ name: tool.name, result })
        onChunk(JSON.stringify({ provider: 'mock', tool: tool.name, result }))
        onDone()
      } catch (e: any) {
        onError(e.message || String(e))
      }
      return { cancel: () => {} }
    }
  }
  return { providers: { mock: MockProvider }, getProviderKey: jest.fn(async () => 'mock-key') }
})

// Mock the rate limit tracker to bypass provider/model checks in tests
jest.mock('../../../../providers/rate-limit-tracker', () => ({
  rateLimitTracker: {
    checkAndWait: jest.fn(async () => 0),
    updateFromHeaders: jest.fn(),
    updateFromError: jest.fn(),
    recordRequest: jest.fn(),
    clearLimits: jest.fn(),
    getLimits: jest.fn(),
    getState: jest.fn(),
  }
}))

// Import real tools
import { readFileTool } from '../../../../tools/fs/readFile'
import { writeFileTool } from '../../../../tools/fs/writeFile'
import { appendFileTool } from '../../../../tools/fs/appendFile'
import { existsTool } from '../../../../tools/fs/exists'
import { statTool } from '../../../../tools/fs/stat'
import { createDirTool } from '../../../../tools/fs/createDir'
import { deleteDirTool } from '../../../../tools/fs/deleteDir'
import { deleteFileTool } from '../../../../tools/fs/deleteFile'
import { moveTool } from '../../../../tools/fs/move'
import { copyTool } from '../../../../tools/fs/copy'
import { removeTool } from '../../../../tools/fs/remove'
import { readDirTool } from '../../../../tools/fs/readDir'
import { truncateFileTool } from '../../../../tools/fs/truncateFile'
import { truncateDirTool } from '../../../../tools/fs/truncateDir'
import { applyEditsTool } from '../../../../tools/edits/apply'
import { searchAstTool } from '../../../../tools/code/searchAst'
import { applyEditsTargetedTool } from '../../../../tools/code/applyEditsTargeted'

// Access the store mock to set workspace root
const storeMock = require('../../../../__mocks__/store-index.js')

async function mkTmpWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hifide-fs-'))
  // Ensure dir exists
  if (!fssync.existsSync(dir)) fssync.mkdirSync(dir, { recursive: true })
  return dir
}

function wrap(tool: AgentTool, run: () => Promise<any>): AgentTool {
  return { ...tool, run: async () => run() }
}

function parseResult(result: any) {
  const parsed = JSON.parse(String(result.data || ''))
  return parsed
}

describe('LLM Request Node - real behavior (fs.*, edits.apply, code.*)', () => {
  let tmp: string

  beforeAll(async () => {
    tmp = await mkTmpWorkspace()
    storeMock.__setWorkspaceRoot(tmp)
  })

  afterAll(async () => {
    try { await fs.rm(tmp, { recursive: true, force: true }) } catch {}
  })

  test('fsReadFile returns raw file content (string)', async () => {
    await fs.writeFile(path.join(tmp, 'foo.txt'), 'hello', 'utf-8')

    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const tool = wrap(readFileTool, async () => readFileTool.run({ path: 'foo.txt' } as any))

    const result = await llmRequestNode(flow as any, ctx as any, 'read foo.txt', createMockNodeInputs({ tools: [tool] }) as any, createTestConfig())
    expect(result.status).toBe('success')
    const parsed = parseResult(result)
    expect(typeof parsed.result).toBe('string')
    expect(parsed.result).toBe('hello')
  })

  test('fs.write_file writes file; fs.exists/stat/append/read reflect changes', async () => {
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })

    // write
    const tWrite = wrap(writeFileTool, async () => writeFileTool.run({ path: 'bar.txt', content: 'abc' } as any))
    let res = await llmRequestNode(flow as any, ctx as any, 'write bar.txt', createMockNodeInputs({ tools: [tWrite] }) as any, createTestConfig())
    expect(res.status).toBe('success')
    expect(await fs.readFile(path.join(tmp, 'bar.txt'), 'utf-8')).toBe('abc')

    // exists
    const tExists = wrap(existsTool, async () => existsTool.run({ path: 'bar.txt' } as any))
    res = await llmRequestNode(flow as any, ctx as any, 'exists bar.txt', createMockNodeInputs({ tools: [tExists] }) as any, createTestConfig())
    expect(JSON.parse(String(res.data)).result.exists).toBe(true)

    // stat
    const tStat = wrap(statTool, async () => statTool.run({ path: 'bar.txt' } as any))
    res = await llmRequestNode(flow as any, ctx as any, 'stat bar.txt', createMockNodeInputs({ tools: [tStat] }) as any, createTestConfig())
    expect(JSON.parse(String(res.data)).result.size).toBeGreaterThan(0)

    // append
    const tAppend = wrap(appendFileTool, async () => appendFileTool.run({ path: 'bar.txt', content: '123' } as any))
    res = await llmRequestNode(flow as any, ctx as any, 'append bar.txt', createMockNodeInputs({ tools: [tAppend] }) as any, createTestConfig())
    expect(await fs.readFile(path.join(tmp, 'bar.txt'), 'utf-8')).toBe('abc123')
  })

  test('fs.create_dir/delete_dir/read_dir/truncate_dir', async () => {
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })

    const tCreate = wrap(createDirTool, async () => createDirTool.run({ path: 'mydir' } as any))
    let r = await llmRequestNode(flow as any, ctx as any, 'create dir', createMockNodeInputs({ tools: [tCreate] }) as any, createTestConfig())
    expect(fssync.existsSync(path.join(tmp, 'mydir'))).toBe(true)

    await fs.writeFile(path.join(tmp, 'mydir', 'x.txt'), 'x', 'utf-8')
    const tReadDir = wrap(readDirTool, async () => readDirTool.run({ path: 'mydir' } as any))
    r = await llmRequestNode(flow as any, ctx as any, 'read dir', createMockNodeInputs({ tools: [tReadDir] }) as any, createTestConfig())
    const entries = JSON.parse(String(r.data)).result.entries
    expect(Array.isArray(entries)).toBe(true)
    expect(entries.some((e: any) => e.name === 'x.txt')).toBe(true)

    const tTruncDir = wrap(truncateDirTool, async () => truncateDirTool.run({ path: 'mydir' } as any))
    r = await llmRequestNode(flow as any, ctx as any, 'truncate dir', createMockNodeInputs({ tools: [tTruncDir] }) as any, createTestConfig())
    expect(fssync.existsSync(path.join(tmp, 'mydir'))).toBe(true)
    expect(fssync.existsSync(path.join(tmp, 'mydir', 'x.txt'))).toBe(false)

    const tDelete = wrap(deleteDirTool, async () => deleteDirTool.run({ path: 'mydir' } as any))
    r = await llmRequestNode(flow as any, ctx as any, 'delete dir', createMockNodeInputs({ tools: [tDelete] }) as any, createTestConfig())
    expect(fssync.existsSync(path.join(tmp, 'mydir'))).toBe(false)
  })

  test('fs.move/copy/remove/delete_file/truncate_file', async () => {
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })

    await fs.writeFile(path.join(tmp, 'a.txt'), 'abcdef', 'utf-8')

    const tMove = wrap(moveTool, async () => moveTool.run({ from: 'a.txt', to: 'b.txt' } as any))
    await llmRequestNode(flow as any, ctx as any, 'move', createMockNodeInputs({ tools: [tMove] }) as any, createTestConfig())
    expect(fssync.existsSync(path.join(tmp, 'a.txt'))).toBe(false)
    expect(fssync.existsSync(path.join(tmp, 'b.txt'))).toBe(true)

    const tCopy = wrap(copyTool, async () => copyTool.run({ from: 'b.txt', to: 'c.txt' } as any))
    await llmRequestNode(flow as any, ctx as any, 'copy', createMockNodeInputs({ tools: [tCopy] }) as any, createTestConfig())
    expect(fssync.existsSync(path.join(tmp, 'b.txt'))).toBe(true)
    expect(fssync.existsSync(path.join(tmp, 'c.txt'))).toBe(true)

    const tTruncFile = wrap(truncateFileTool, async () => truncateFileTool.run({ path: 'c.txt' } as any))
    await llmRequestNode(flow as any, ctx as any, 'truncate file', createMockNodeInputs({ tools: [tTruncFile] }) as any, createTestConfig())
    expect((await fs.readFile(path.join(tmp, 'c.txt'), 'utf-8')).length).toBe(0)

    const tDeleteFile = wrap(deleteFileTool, async () => deleteFileTool.run({ path: 'b.txt' } as any))
    await llmRequestNode(flow as any, ctx as any, 'delete file', createMockNodeInputs({ tools: [tDeleteFile] }) as any, createTestConfig())
    expect(fssync.existsSync(path.join(tmp, 'b.txt'))).toBe(false)

    const tRemove = wrap(removeTool, async () => removeTool.run({ path: 'c.txt' } as any))
    await llmRequestNode(flow as any, ctx as any, 'remove file', createMockNodeInputs({ tools: [tRemove] }) as any, createTestConfig())
    expect(fssync.existsSync(path.join(tmp, 'c.txt'))).toBe(false)
  })

  test('edits.apply modifies files as expected', async () => {
    await fs.writeFile(path.join(tmp, 'edit.txt'), 'hello world', 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })

    const payload1 = [
      'File: edit.txt',
      '<<<<<<< SEARCH',
      'hello world',
      '=======',
      'hi world',
      '>>>>>>> REPLACE',
    ].join('\n')
    const tEdits = wrap(applyEditsTool, async () => applyEditsTool.run({ payload: payload1 } as any))

    const res = await llmRequestNode(flow as any, ctx as any, 'apply edits', createMockNodeInputs({ tools: [tEdits] }) as any, createTestConfig())
    const parsed = parseResult(res)
    expect(parsed.result.ok).toBe(true)
    expect(parsed.result.applied).toBeGreaterThan(0)
    expect(await fs.readFile(path.join(tmp, 'edit.txt'), 'utf-8')).toBe('hi world')
  })

  test('edits.apply preserves newline between replaced range and next line (LF)', async () => {
    const p = path.join(tmp, 'newline-lf.txt')
    await fs.writeFile(p, 'a\nb\nc\n', 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const payload2 = [
      'File: newline-lf.txt',
      '<<<<<<< SEARCH',
      'b',
      '=======',
      'B',
      '>>>>>>> REPLACE',
    ].join('\n')
    const tEdits = wrap(applyEditsTool, async () => applyEditsTool.run({ payload: payload2 } as any))
    await llmRequestNode(flow as any, ctx as any, 'apply edits', createMockNodeInputs({ tools: [tEdits] }) as any, createTestConfig())
    const next = await fs.readFile(p, 'utf-8')
    expect(next).toBe('a\nB\nc\n')
  })

  test('edits.apply preserves lack of final newline at EOF', async () => {
    const p = path.join(tmp, 'noeof.txt')
    await fs.writeFile(p, 'a\nb', 'utf-8') // no final newline
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const payload3 = [
      'File: noeof.txt',
      '<<<<<<< SEARCH',
      'b',
      '=======',
      'B',
      '>>>>>>> REPLACE',
    ].join('\n')
    const tEdits = wrap(applyEditsTool, async () => applyEditsTool.run({ payload: payload3 } as any))
    await llmRequestNode(flow as any, ctx as any, 'apply edits', createMockNodeInputs({ tools: [tEdits] }) as any, createTestConfig())
    const next = await fs.readFile(p, 'utf-8')
    expect(next).toBe('a\nB') // still no final newline
  })


  test('edits.apply preserves CRLF style and boundary newline', async () => {
    const p = path.join(tmp, 'newline-crlf.txt')
    const content = 'a\r\nb\r\nc\r\n'
    await fs.writeFile(p, content, 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const payload4 = [
      'File: newline-crlf.txt',
      '<<<<<<< SEARCH',
      'b',
      '=======',
      'B',
      '>>>>>>> REPLACE',
    ].join('\n')
    const tEdits = wrap(applyEditsTool, async () => applyEditsTool.run({ payload: payload4 } as any))
    await llmRequestNode(flow as any, ctx as any, 'apply edits', createMockNodeInputs({ tools: [tEdits] }) as any, createTestConfig())
    const next = await fs.readFile(p, 'utf-8')
    expect(next).toBe('a\r\nB\r\nc\r\n')
  })

  test('edits.apply multi-line replacement does not duplicate first line (LF)', async () => {
    const p = path.join(tmp, 'zoom-lf.ts')
    const original = [
      'export const MAX_ZOOM = 20;',
      'export const MIN_ZOOM = 0.02;',
      'export const ZOOM_BREAKPOINTS = {',
      '  CLUSTER: 0.02,',
      '  PROJECT: 0.2,',
      '  MODULE: 0.8,',
      '  SYSTEM: 1.8,',
      '};',
      '',
    ].join('\n')
    await fs.writeFile(p, original, 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const replacement = [
      'export const ZOOM_BREAKPOINTS = {',
      '  CLUSTER: 0.05,',
      '  SYSTEM: 1.5,',
      '};',
    ].join('\n')
    const payload5 = [
      'File: zoom-lf.ts',
      '<<<<<<< SEARCH',
      'export const ZOOM_BREAKPOINTS = {',
      '  CLUSTER: 0.02,',
      '  PROJECT: 0.2,',
      '  MODULE: 0.8,',
      '  SYSTEM: 1.8,',
      '};',
      '=======',
      replacement,
      '>>>>>>> REPLACE',
    ].join('\n')
    const tEdits = wrap(applyEditsTool, async () => applyEditsTool.run({ payload: payload5 } as any))
    await llmRequestNode(flow as any, ctx as any, 'apply', createMockNodeInputs({ tools: [tEdits] }) as any, createTestConfig())
    const next = await fs.readFile(p, 'utf-8')
    const expected = [
      'export const MAX_ZOOM = 20;',
      'export const MIN_ZOOM = 0.02;',
      'export const ZOOM_BREAKPOINTS = {',
      '  CLUSTER: 0.05,',
      '  SYSTEM: 1.5,',
      '};',
      '',
    ].join('\n')
    expect(next).toBe(expected)
  })

  test('edits.apply multi-line replacement does not duplicate first line (CRLF)', async () => {
    const p = path.join(tmp, 'zoom-crlf.ts')
    const original = [
      'export const MAX_ZOOM = 20;',
      'export const MIN_ZOOM = 0.02;',
      'export const ZOOM_BREAKPOINTS = {',
      '  CLUSTER: 0.02,',
      '  PROJECT: 0.2,',
      '  MODULE: 0.8,',
      '  SYSTEM: 1.8,',
      '};',
      '',
    ].join('\r\n')
    await fs.writeFile(p, original, 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const replacement = [
      'export const ZOOM_BREAKPOINTS = {',
      '  CLUSTER: 0.05,',
      '  SYSTEM: 1.5,',
      '};',
    ].join('\r\n')
    const payload6 = [
      'File: zoom-crlf.ts',
      '<<<<<<< SEARCH',
      'export const ZOOM_BREAKPOINTS = {',
      '  CLUSTER: 0.02,',
      '  PROJECT: 0.2,',
      '  MODULE: 0.8,',
      '  SYSTEM: 1.8,',
      '};',
      '=======',
      replacement,
      '>>>>>>> REPLACE',
    ].join('\n')
    const tEdits = wrap(applyEditsTool, async () => applyEditsTool.run({ payload: payload6 } as any))
    await llmRequestNode(flow as any, ctx as any, 'apply', createMockNodeInputs({ tools: [tEdits] }) as any, createTestConfig())
    const next = await fs.readFile(p, 'utf-8')
    const expected = [
      'export const MAX_ZOOM = 20;',
      'export const MIN_ZOOM = 0.02;',
      'export const ZOOM_BREAKPOINTS = {',
      '  CLUSTER: 0.05,',
      '  SYSTEM: 1.5,',
      '};',
      '',
    ].join('\r\n')
    expect(next).toBe(expected)
  })

  test('edits.apply multi-line replacement drops duplicated first line if header left outside range (LF)', async () => {
    const p = path.join(tmp, 'zoom2-lf.ts')
    const original = [
      'export const MAX_ZOOM = 20;',
      'export const MIN_ZOOM = 0.02;',
      'export const ZOOM_BREAKPOINTS = {',
      '  CLUSTER: 0.02,',
      '  PROJECT: 0.2,',
      '  MODULE: 0.8,',
      '  SYSTEM: 1.8,',
      '};',
      '',
    ].join('\n')
    await fs.writeFile(p, original, 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const replacement = [
      'export const ZOOM_BREAKPOINTS = {',
      '  CLUSTER: 0.05,',
      '  SYSTEM: 1.5,',
      '};',
    ].join('\n')
    const payload7 = [
      'File: zoom2-lf.ts',
      '<<<<<<< SEARCH',
      '  CLUSTER: 0.02,',
      '  PROJECT: 0.2,',
      '  MODULE: 0.8,',
      '  SYSTEM: 1.8,',
      '};',
      '=======',
      '  CLUSTER: 0.05,',
      '  SYSTEM: 1.5,',
      '};',
      '>>>>>>> REPLACE',
    ].join('\n')
    const tEdits = wrap(applyEditsTool, async () => applyEditsTool.run({ payload: payload7 } as any))
    await llmRequestNode(flow as any, ctx as any, 'apply', createMockNodeInputs({ tools: [tEdits] }) as any, createTestConfig())
    const next = await fs.readFile(p, 'utf-8')
    const expected = [
      'export const MAX_ZOOM = 20;',
      'export const MIN_ZOOM = 0.02;',
      'export const ZOOM_BREAKPOINTS = {',
      '  CLUSTER: 0.05,',
      '  SYSTEM: 1.5,',
      '};',
      '',
    ].join('\n')
    expect(next).toBe(expected)
  })

  test('edits.apply multi-line replacement drops duplicated first line if header left outside range (CRLF)', async () => {
    const p = path.join(tmp, 'zoom2-crlf.ts')
    const original = [
      'export const MAX_ZOOM = 20;',
      'export const MIN_ZOOM = 0.02;',
      'export const ZOOM_BREAKPOINTS = {',
      '  CLUSTER: 0.02,',
      '  PROJECT: 0.2,',
      '  MODULE: 0.8,',
      '  SYSTEM: 1.8,',
      '};',
      '',
    ].join('\r\n')
    await fs.writeFile(p, original, 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const replacement = [
      'export const ZOOM_BREAKPOINTS = {',
      '  CLUSTER: 0.05,',
      '  SYSTEM: 1.5,',
      '};',
    ].join('\r\n')
    const payload8 = [
      'File: zoom2-crlf.ts',
      '<<<<<<< SEARCH',
      '  CLUSTER: 0.02,',
      '  PROJECT: 0.2,',
      '  MODULE: 0.8,',
      '  SYSTEM: 1.8,',
      '};',
      '=======',
      '  CLUSTER: 0.05,',
      '  SYSTEM: 1.5,',
      '};',
      '>>>>>>> REPLACE',
    ].join('\n')
    const tEdits = wrap(applyEditsTool, async () => applyEditsTool.run({ payload: payload8 } as any))
    await llmRequestNode(flow as any, ctx as any, 'apply', createMockNodeInputs({ tools: [tEdits] }) as any, createTestConfig())
    const next = await fs.readFile(p, 'utf-8')
    const expected = [
      'export const MAX_ZOOM = 20;',
      'export const MIN_ZOOM = 0.02;',
      'export const ZOOM_BREAKPOINTS = {',
      '  CLUSTER: 0.05,',
      '  SYSTEM: 1.5,',
      '};',
      '',
    ].join('\r\n')
    expect(next).toBe(expected)
  })


  test('edits.apply supports two consecutive ranges at top-of-file (LF)', async () => {
    const p = path.join(tmp, 'consec-lf.txt')
    const original = ['L1','L2','L3','L4',''].join('\n')
    await fs.writeFile(p, original, 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const payload9 = [
      'File: consec-lf.txt',
      '<<<<<<< SEARCH',
      'L1',
      'L2',
      '=======',
      'A1',
      'A2',
      '>>>>>>> REPLACE',
      '',
      'File: consec-lf.txt',
      '<<<<<<< SEARCH',
      'L3',
      'L4',
      '=======',
      'B3',
      'B4',
      '>>>>>>> REPLACE',
    ].join('\n')
    const tEdits = wrap(applyEditsTool, async () => applyEditsTool.run({ payload: payload9 } as any))
    await llmRequestNode(flow as any, ctx as any, 'apply', createMockNodeInputs({ tools: [tEdits] }) as any, createTestConfig())
    const next = await fs.readFile(p, 'utf-8')
    expect(next).toBe(['A1','A2','B3','B4',''].join('\n'))
  })

  test('edits.apply supports two consecutive ranges at top-of-file (CRLF)', async () => {
    const p = path.join(tmp, 'consec-crlf.txt')
    const original = ['L1','L2','L3','L4',''].join('\r\n')
    await fs.writeFile(p, original, 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const payload10 = [
      'File: consec-crlf.txt',
      '<<<<<<< SEARCH',
      'L1',
      'L2',
      '=======',
      'A1',
      'A2',
      '>>>>>>> REPLACE',
      '',
      'File: consec-crlf.txt',
      '<<<<<<< SEARCH',
      'L3',
      'L4',
      '=======',
      'B3',
      'B4',
      '>>>>>>> REPLACE',
    ].join('\n')
    const tEdits = wrap(applyEditsTool, async () => applyEditsTool.run({ payload: payload10 } as any))
    await llmRequestNode(flow as any, ctx as any, 'apply', createMockNodeInputs({ tools: [tEdits] }) as any, createTestConfig())
    const next = await fs.readFile(p, 'utf-8')
    expect(next).toBe(['A1','A2','B3','B4',''].join('\r\n'))
  })

  test('code.apply_edits_targeted replaceRange preserves boundary newline (LF)', async () => {
    const p = path.join(tmp, 'range-boundary-lf.txt')
    const original = ['A','B','C',''].join('\n')
    await fs.writeFile(p, original, 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const sliceLen = ['A','B',''].join('\n').length // 'A\nB\n'
    const t = wrap(applyEditsTargetedTool, async () => applyEditsTargetedTool.run({
      textEdits: [{ type: 'replaceRange', path: 'range-boundary-lf.txt', start: 0, end: sliceLen, text: 'X' }],
      verify: false
    } as any))
    await llmRequestNode(flow as any, ctx as any, 'apply range', createMockNodeInputs({ tools: [t] }) as any, createTestConfig())
    const next = await fs.readFile(p, 'utf-8')
    expect(next).toBe(['X','C',''].join('\n'))
  })

  test('code.apply_edits_targeted replaceRange preserves boundary newline (CRLF)', async () => {
    const p = path.join(tmp, 'range-boundary-crlf.txt')
    const original = ['A','B','C',''].join('\r\n')
    await fs.writeFile(p, original, 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const sliceLen = ['A','B',''].join('\r\n').length // 'A\r\nB\r\n'
    const t = wrap(applyEditsTargetedTool, async () => applyEditsTargetedTool.run({
      textEdits: [{ type: 'replaceRange', path: 'range-boundary-crlf.txt', start: 0, end: sliceLen, text: 'X' }],
      verify: false
    } as any))
    await llmRequestNode(flow as any, ctx as any, 'apply range', createMockNodeInputs({ tools: [t] }) as any, createTestConfig())
    const next = await fs.readFile(p, 'utf-8')
    expect(next).toBe(['X','C',''].join('\r\n'))
  })

  test('edits.apply supports OpenAI Patch add/update/delete', async () => {
    const upd = path.join(tmp, 'upd.txt')
    const del = path.join(tmp, 'del.txt')
    await fs.writeFile(upd, 'hello', 'utf-8')
    await fs.writeFile(del, 'bye', 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const payload = [
      '*** Begin Patch',
      '*** Update File: upd.txt',
      '@@',
      '-hello',
      '+world',
      '*** Add File: add.txt',
      'new content',
      '*** Delete File: del.txt',
      '*** End Patch',
    ].join('\n')
    const t = wrap(applyEditsTool, async () => applyEditsTool.run({ payload } as any))
    const res = await llmRequestNode(flow as any, ctx as any, 'apply openai patch', createMockNodeInputs({ tools: [t] }) as any, createTestConfig())
    const parsed = parseResult(res)
    expect(parsed.result.ok).toBe(true)
    expect(await fs.readFile(upd, 'utf-8')).toBe('world')
    expect(fssync.existsSync(path.join(tmp, 'add.txt'))).toBe(true)
    expect(await fs.readFile(path.join(tmp, 'add.txt'), 'utf-8')).toBe('new content')
    expect(fssync.existsSync(del)).toBe(false)
  })

  test('edits.apply accepts unified diff via applyPatch delegation', async () => {
    const p = path.join(tmp, 'ud.txt')
    await fs.writeFile(p, ['foo','bar',''].join('\n'), 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const diff = [
      'diff --git a/ud.txt b/ud.txt',
      '--- a/ud.txt',
      '+++ b/ud.txt',
      '@@ -1,1 +1,1 @@',
      '-foo',
      '+FOO',
    ].join('\n')
    const t = wrap(applyEditsTool, async () => applyEditsTool.run({ payload: diff } as any))
    await llmRequestNode(flow as any, ctx as any, 'apply unified diff', createMockNodeInputs({ tools: [t] }) as any, createTestConfig())
    const next = await fs.readFile(p, 'utf-8')
    expect(next).toBe(['FOO','bar',''].join('\n'))
  })

  test('edits.apply pathless Search/Replace with unique match', async () => {
    await fs.writeFile(path.join(tmp, 'only.txt'), ['alpha','unique_anchor_xyz','beta',''].join('\n'), 'utf-8')
    await fs.writeFile(path.join(tmp, 'other.txt'), ['alpha','other','beta',''].join('\n'), 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const payload = [
      '<<<<<<< SEARCH',
      'unique_anchor_xyz',
      '=======',
      'unique_anchor_xyz changed',
      '>>>>>>> REPLACE',
    ].join('\n')
    const t = wrap(applyEditsTool, async () => applyEditsTool.run({ payload } as any))
    await llmRequestNode(flow as any, ctx as any, 'apply pathless', createMockNodeInputs({ tools: [t] }) as any, createTestConfig())
    const a = await fs.readFile(path.join(tmp, 'only.txt'), 'utf-8')
    const b = await fs.readFile(path.join(tmp, 'other.txt'), 'utf-8')
    expect(a.includes('unique_anchor_xyz changed')).toBe(true)
    expect(b.includes('unique_anchor_xyz changed')).toBe(false)
  })

  test('edits.apply denies node_modules and respects .gitignore', async () => {
    const deniedDir = path.join(tmp, 'node_modules')
    await fs.mkdir(deniedDir, { recursive: true })
    await fs.writeFile(path.join(deniedDir, 'denied.txt'), 'BAD', 'utf-8')
    await fs.writeFile(path.join(tmp, '.gitignore'), 'ignored.txt\n', 'utf-8')
    await fs.writeFile(path.join(tmp, 'ignored.txt'), 'SECRET', 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })

    const payloadDenied = [
      'File: node_modules/denied.txt',
      '<<<<<<< SEARCH',
      'BAD',
      '=======',
      'GOOD',
      '>>>>>>> REPLACE',
    ].join('\n')
    const tDenied = wrap(applyEditsTool, async () => applyEditsTool.run({ payload: payloadDenied } as any))
    const r1 = await llmRequestNode(flow as any, ctx as any, 'apply denied', createMockNodeInputs({ tools: [tDenied] }) as any, createTestConfig())
    expect(await fs.readFile(path.join(deniedDir, 'denied.txt'), 'utf-8')).toBe('BAD')

    const payloadIgnored = [
      'File: ignored.txt',
      '<<<<<<< SEARCH',
      'SECRET',
      '=======',
      'PUBLIC',
      '>>>>>>> REPLACE',
    ].join('\n')
    const tIgnored = wrap(applyEditsTool, async () => applyEditsTool.run({ payload: payloadIgnored } as any))
    const r2 = await llmRequestNode(flow as any, ctx as any, 'apply gitignored', createMockNodeInputs({ tools: [tIgnored] }) as any, createTestConfig())
    expect(await fs.readFile(path.join(tmp, 'ignored.txt'), 'utf-8')).toBe('SECRET')

    // ensure results carry messages
    const pr1 = parseResult(r1)
    const pr2 = parseResult(r2)
    expect(pr1.result.results.some((x: any) => x.message === 'denied-path')).toBe(true)
    expect(pr2.result.results.some((x: any) => x.message === 'gitignored')).toBe(true)
  })

  test('edits.apply reports partial-ok when some groups fail (OpenAI Patch)', async () => {
    const p = path.join(tmp, 'part.txt')
    await fs.writeFile(p, ['A','B','C',''].join('\n'), 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const payload = [
      '*** Begin Patch',
      '*** Update File: part.txt',
      '@@',
      '-B',
      '+X',
      '@@',
      '-Z',
      '+Y',
      '*** End Patch',
    ].join('\n')
    const t = wrap(applyEditsTool, async () => applyEditsTool.run({ payload } as any))
    const res = await llmRequestNode(flow as any, ctx as any, 'apply partial', createMockNodeInputs({ tools: [t] }) as any, createTestConfig())
    const next = await fs.readFile(p, 'utf-8')
    expect(next).toBe(['A','X','C',''].join('\n'))
    const parsed = parseResult(res)
    const entry = parsed.result.results.find((r: any) => r.path === 'part.txt')
    expect(entry && typeof entry.message === 'string' && entry.message.includes('partial-ok')).toBe(true)
  })





  describe('code.* (conditional: requires @ast-grep/napi)', () => {
    const hasAstGrep: boolean = (() => { try { require.resolve('@ast-grep/napi'); return true } catch { return false } })()
    const maybe = hasAstGrep ? test : test.skip

    maybe('code.search_ast finds console.log calls', async () => {
      await fs.writeFile(path.join(tmp, 'code.ts'), 'function x(){ console.log(1); }', 'utf-8')
      const flow = createMockFlowAPI()
      const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
      const t = wrap(searchAstTool, async () => searchAstTool.run({ pattern: 'console.log($VAL)', languages: ['ts'], includeGlobs: ['**/*.ts'] } as any))
      const res = await llmRequestNode(flow as any, ctx as any, 'search ast', createMockNodeInputs({ tools: [t] }) as any, createTestConfig())
      const parsed = parseResult(res)
      expect(parsed.result.ok).toBe(true)
      expect(parsed.result.matches.length).toBeGreaterThan(0)
    })

    maybe('code.apply_edits_targeted rewrites console.log to console.debug', async () => {
      await fs.writeFile(path.join(tmp, 'code2.ts'), 'console.log("hi");', 'utf-8')
      const flow = createMockFlowAPI()
      const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
      const t = wrap(applyEditsTargetedTool, async () => applyEditsTargetedTool.run({
        astRewrites: [{ pattern: 'console.log($VAL)', rewrite: 'console.debug($VAL)', languages: ['ts'], includeGlobs: ['**/code2.ts'] }],
        verify: false
      } as any))
      await llmRequestNode(flow as any, ctx as any, 'apply code edits', createMockNodeInputs({ tools: [t] }) as any, createTestConfig())
      const next = await fs.readFile(path.join(tmp, 'code2.ts'), 'utf-8')
      expect(next.includes('console.debug(')).toBe(true)
    })
  })
})

