/**
 * LLM Request Node - Real behavior tests for fs.read_lines
 */

import fs from 'node:fs/promises'
import fssync from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { ProviderAdapter, AgentTool } from '../../../../providers/provider'
import { llmRequestNode } from '../llmRequest'
import { createMainFlowContext, createMockFlowAPI, createMockNodeInputs, createTestConfig } from '../../../../__tests__/utils/testHelpers'

// Use store mock to control workspace root
const { __setWorkspaceRoot } = require('../../../../__mocks__/store-index.js')

// Mock rate limit tracker to avoid provider/model matrix assumptions
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

// Mock provider registry for llm-service
jest.mock('../../../../core/state', () => {
  const MockProvider: ProviderAdapter = {
    id: 'mock',
    async chatStream({ onChunk, onDone, onError }) {
      try { onChunk('[mock-chat]'); onDone() } catch (e: any) { onError(e.message || String(e)) }
      return { cancel: () => {} }
    },
    async agentStream({ tools, onChunk, onDone, onError, onToolStart, onToolEnd, toolMeta }) {
      try {
        const tool = tools?.[0]
        if (!tool) throw new Error('No tool provided')
        const args = (tool as any).__args || {}
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

// Helper to wrap a tool with fixed args
function wrapWithArgs(t: AgentTool, args: any): AgentTool {
  const w: AgentTool = {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    run: t.run
  }
  ;(w as any).__args = args
  return w
}

import { readLinesTool } from '../../../../tools/fs/readLines'

describe('fs.read_lines (real)', () => {
  let tmp: string

  beforeEach(async () => {
    const base = os.tmpdir()
    tmp = path.join(base, `readlines-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await fs.mkdir(tmp, { recursive: true })
    __setWorkspaceRoot(tmp)
  })

  afterEach(async () => {
    try { await fs.rm(tmp, { recursive: true, force: true }) } catch {}
  })

  function makeFile(lines: number) {
    const arr = Array.from({ length: lines }, (_, i) => `Line ${i + 1}`)
    return arr.join('\n') + '\n'
  }

  test('head default returns 250 lines', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), makeFile(1000), 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const tool = wrapWithArgs(readLinesTool, { path: 'a.txt', mode: 'head' })
    const res = await llmRequestNode(flow as any, ctx as any, 'use tool', createMockNodeInputs({ tools: [tool] }) as any, createTestConfig())
    const parsed = JSON.parse(String(res.data))
    expect(parsed.tool).toBe('fs.read_lines')
    expect(parsed.result.ok).toBe(true)
    expect(parsed.result.lineCount).toBe(250)
  })

  test('range 101..120 returns 20 lines', async () => {
    await fs.writeFile(path.join(tmp, 'b.txt'), makeFile(300), 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const tool = wrapWithArgs(readLinesTool, { path: 'b.txt', mode: 'range', startLine: 101, endLine: 120 })
    const res = await llmRequestNode(flow as any, ctx as any, 'use tool', createMockNodeInputs({ tools: [tool] }) as any, createTestConfig())
    const parsed = JSON.parse(String(res.data))
    expect(parsed.result.ok).toBe(true)
    expect(parsed.result.lineCount).toBe(20)
    expect(parsed.result.startLine).toBe(101)
    expect(parsed.result.endLine).toBe(120)
  })

  test('tail 10 returns last 10 lines', async () => {
    await fs.writeFile(path.join(tmp, 'c.txt'), makeFile(50), 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const tool = wrapWithArgs(readLinesTool, { path: 'c.txt', mode: 'tail', tailLines: 10 })
    const res = await llmRequestNode(flow as any, ctx as any, 'use tool', createMockNodeInputs({ tools: [tool] }) as any, createTestConfig())
    const parsed = JSON.parse(String(res.data))
    expect(parsed.result.ok).toBe(true)
    expect(parsed.result.lineCount).toBe(10)
  })

  test('regex finds lines with context', async () => {
    await fs.writeFile(path.join(tmp, 'd.txt'), makeFile(120), 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const tool = wrapWithArgs(readLinesTool, { path: 'd.txt', mode: 'regex', pattern: 'Line 4\\d', contextBefore: 1, contextAfter: 1, maxMatches: 3 })
    const res = await llmRequestNode(flow as any, ctx as any, 'use tool', createMockNodeInputs({ tools: [tool] }) as any, createTestConfig())
    const parsed = JSON.parse(String(res.data))
    expect(parsed.result.ok).toBe(true)
    expect(Array.isArray(parsed.result.matches)).toBe(true)
    expect(parsed.result.matches.length).toBeGreaterThan(0)
  })

  test('around mode returns window around focus line', async () => {
    await fs.writeFile(path.join(tmp, 'e.txt'), makeFile(200), 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const tool = wrapWithArgs(readLinesTool, { path: 'e.txt', mode: 'around', focusLine: 50, beforeLines: 2, afterLines: 2 })
    const res = await llmRequestNode(flow as any, ctx as any, 'use tool', createMockNodeInputs({ tools: [tool] }) as any, createTestConfig())
    const parsed = JSON.parse(String(res.data))
    expect(parsed.result.ok).toBe(true)
    expect(parsed.result.lineCount).toBe(5)
    expect(parsed.result.startLine).toBe(48)
    expect(parsed.result.endLine).toBe(52)
  })

  test('around mode with window convenience param sets symmetric window', async () => {
    await fs.writeFile(path.join(tmp, 'f.txt'), makeFile(300), 'utf-8')
    const flow = createMockFlowAPI()
    const ctx = createMainFlowContext({ provider: 'mock', model: 'mock-001' })
    const tool = wrapWithArgs(readLinesTool, { path: 'f.txt', mode: 'around', focusLine: 100, window: 3 })
    const res = await llmRequestNode(flow as any, ctx as any, 'use tool', createMockNodeInputs({ tools: [tool] }) as any, createTestConfig())
    const parsed = JSON.parse(String(res.data))
    expect(parsed.result.ok).toBe(true)
    expect(parsed.result.lineCount).toBe(7)
    expect(parsed.result.startLine).toBe(97)
    expect(parsed.result.endLine).toBe(103)
  })
})

