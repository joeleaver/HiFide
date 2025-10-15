/**
 * HiFide Main Process Entry Point
 *
 * This is the main entry point for the Electron main process.
 * Most functionality has been extracted into focused modules in electron/ipc/ and electron/core/.
 *
 * What remains in this file:
 * - Environment setup
 * - Provider initialization
 * - Agent tools registry (TODO: Extract to separate module in future iteration)
 * - Application initialization
 */

import { ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Core modules
import { initializeApp } from './core/app'
import { registerAllHandlers } from './ipc/registry'
import { buildMenu } from './ipc/menu'

// Provider setup
import { OpenAIProvider } from './providers/openai'
import { AnthropicProvider } from './providers/anthropic'
import { GeminiProvider } from './providers/gemini'
import { registerRateLimitIpc } from './providers/ratelimit'
import type { AgentTool } from './providers/provider'
import { verifyTypecheck as tsVerify } from './refactors/ts'

// Additional imports for agent tools helpers
import fs from 'node:fs/promises'
import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'


const exec = promisify(execCb)

// State management
import { providers, providerCapabilities, getWebContents } from './core/state'

// Agent dependencies
import { initAgentSessionsCleanup, getOrCreateSession } from './session/agentSessions'
import type { TaskAssessment, TaskType } from './agent/types'
import { calculateBudget, getResourceRecommendation } from './agent/types'
import { getIndexer } from './core/state'
import { astGrepSearch, astGrepRewrite } from './tools/astGrep'

// Environment setup
const DIRNAME = path.dirname(fileURLToPath(import.meta.url))
process.env.APP_ROOT = path.join(DIRNAME, '..')
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// Initialize provider adapters
providers.openai = OpenAIProvider as any
// ----------------------------------------------------------------------------
// Helper functions used by agent tools (ported from legacy main.ts)
// ----------------------------------------------------------------------------

function resolveWithinWorkspace(p: string): string {
  const root = path.resolve(process.env.APP_ROOT || process.cwd())
  const abs = path.isAbsolute(p) ? p : path.join(root, p)
  const norm = path.resolve(abs)
  const guard = root.endsWith(path.sep) ? root : root + path.sep
  if (!(norm + path.sep).startsWith(guard)) throw new Error('Path outside workspace')
  return norm
}

async function atomicWrite(filePath: string, content: string) {
  // Simple atomic write; can be enhanced with tmp file + rename
  await fs.writeFile(filePath, content, 'utf-8')
}

async function logEvent(sessionId: string, type: string, payload: any) {
  try {
    const logging = await import('./utils/logging')
    await logging.logEvent(sessionId, type, payload)
  } catch {}
}

function isRiskyCommand(cmd: string): { risky: boolean; reason?: string } {
  try {
    // Use existing security utility
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sec = require('./utils/security')
    return sec.isRiskyCommand(cmd)
  } catch {
    // Conservative fallback
    const c = (cmd || '').trim()
    if (/\b(pnpm|npm|yarn)\s+install\b/i.test(c)) return { risky: true, reason: 'package install' }
    if (/\b(pnpm|npm|yarn)\s+add\b/i.test(c)) return { risky: true, reason: 'package add' }
    if (/\brm\s+-rf\b/i.test(c)) return { risky: true, reason: 'recursive delete' }
    if (/\bgit\s+(push|force|reset)\b/i.test(c)) return { risky: true, reason: 'git dangerous op' }
    return { risky: false }
  }
}

function redactOutput(input: string): { redacted: string; bytesRedacted: number } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sec = require('./utils/security')
    return sec.redactOutput(input)
  } catch {
    let redacted = input || ''
    const patterns: RegExp[] = [/(?:sk|rk|pk|ak)-[A-Za-z0-9]{16,}/g, /Bearer\s+[A-Za-z0-9\-_.=]+/gi]
    const beforeLen = redacted.length
    for (const re of patterns) redacted = redacted.replace(re, '[REDACTED]')
    return { redacted, bytesRedacted: Math.max(0, beforeLen - redacted.length) }
  }
}

async function applyFileEditsInternal(edits: any[] = [], opts: { dryRun?: boolean; verify?: boolean; tsconfigPath?: string } = {}) {
  const mod = await import('./ipc/edits')
  return (mod as any).applyFileEditsInternal(edits, opts)
}

providers.anthropic = AnthropicProvider as any
providers.gemini = GeminiProvider as any

// Initialize provider capabilities
providerCapabilities.openai = { tools: true, jsonSchema: true, vision: false, streaming: true }
providerCapabilities.anthropic = { tools: true, jsonSchema: false, vision: false, streaming: true }
providerCapabilities.gemini = { tools: true, jsonSchema: true, vision: true, streaming: true }

// ============================================================================
// AGENT TOOLS REGISTRY
// ============================================================================
// TODO: Extract this to electron/agent/tools.ts in a future iteration
// This is ~1,026 lines and will be refactored separately
// For now, it's exposed via globalThis for access by llm-agent module
// ============================================================================

const agentTools: AgentTool[] = [
  // Self-regulation tools - allow agent to manage its own resources
  {
    name: 'agent.assess_task',
    description: 'Analyze the user request to determine scope and plan your approach. Call this FIRST before taking other actions to understand your resource budget.',
    parameters: {
      type: 'object',
      properties: {
        task_type: {
          type: 'string',
          enum: ['simple_query', 'file_edit', 'multi_file_refactor', 'codebase_audit', 'exploration'],
          description: 'What type of task is this? simple_query=read 1 file, file_edit=edit 1-3 files, multi_file_refactor=edit 4+ files, codebase_audit=analyze entire codebase, exploration=understand structure',
        },
        estimated_files: {
          type: 'number',
          description: 'How many files will you likely need to examine?',
        },
        estimated_iterations: {
          type: 'number',
          description: 'How many tool-calling rounds do you estimate?',
        },
        strategy: {
          type: 'string',
          description: 'Brief description of your approach (1-2 sentences)',
        },
      },
      required: ['task_type', 'estimated_files', 'estimated_iterations', 'strategy'],
      additionalProperties: false,
    },
    run: async (input: { task_type: TaskType; estimated_files: number; estimated_iterations: number; strategy: string }, meta?: { requestId?: string }) => {
      const requestId = meta?.requestId || 'unknown'
      const session = getOrCreateSession(requestId)

      const budget = calculateBudget(input.task_type, input.estimated_files)

      const assessment: TaskAssessment = {
        task_type: input.task_type,
        estimated_files: input.estimated_files,
        estimated_iterations: input.estimated_iterations,
        strategy: input.strategy,
        token_budget: budget.tokens,
        max_iterations: budget.iterations,
        timestamp: Date.now(),
      }

      session.assessment = assessment

      return {
        ok: true,
        assessment,
        guidance: `Task assessed as "${input.task_type}". You have a budget of ${budget.tokens.toLocaleString()} tokens and ${budget.iterations} iterations. Strategy: ${input.strategy}`,
      }
    },
  },
  {
    name: 'agent.check_resources',
    description: 'Check your current token usage and remaining budget. Use this periodically to stay aware of resource constraints.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    run: async (_input: any, meta?: { requestId?: string }) => {
      const requestId = meta?.requestId || 'unknown'
      const session = getOrCreateSession(requestId)

      const tokenBudget = session.assessment?.token_budget || 50000
      const maxIterations = session.assessment?.max_iterations || 10

      const stats = {
        tokens_used: session.cumulativeTokens,
        tokens_budget: tokenBudget,
        tokens_remaining: tokenBudget - session.cumulativeTokens,
        percentage_used: parseFloat(((session.cumulativeTokens / tokenBudget) * 100).toFixed(1)),
        iterations_used: session.iterationCount,
        iterations_max: maxIterations,
        iterations_remaining: maxIterations - session.iterationCount,
      }

      const recommendation = getResourceRecommendation(stats)

      return {
        ok: true,
        ...stats,
        recommendation,
      }
    },
  },
  {
    name: 'agent.summarize_progress',
    description: 'Summarize what you have learned so far to compress context. Use this when you notice the conversation getting long (>10 tool calls) or before reading many more files.',
    parameters: {
      type: 'object',
      properties: {
        key_findings: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of key findings from your investigation so far',
        },
        files_examined: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files you have already read (so you don\'t re-read them)',
        },
        next_steps: {
          type: 'array',
          items: { type: 'string' },
          description: 'What you still need to investigate',
        },
      },
      required: ['key_findings', 'files_examined', 'next_steps'],
      additionalProperties: false,
    },
    run: async (input: { key_findings: string[]; files_examined: string[]; next_steps: string[] }, meta?: { requestId?: string }) => {
      const requestId = meta?.requestId || 'unknown'
      const session = getOrCreateSession(requestId)

      const summary = {
        key_findings: input.key_findings,
        files_examined: input.files_examined,
        next_steps: input.next_steps,
        timestamp: Date.now(),
      }

      session.summaries.push(summary)

      return {
        ok: true,
        summary,
        message: 'Progress summarized. Previous tool outputs will be compressed to save tokens.',
        _meta: { trigger_pruning: true, summary },
      }
    },
  },

  // File system tools
  {
    name: 'fs.read_file',
    description: 'Read a UTF-8 text file from the workspace',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Workspace-relative path' } },
      required: ['path'],
      additionalProperties: false,
    },
    run: async ({ path: rel }: { path: string }) => {
      const abs = resolveWithinWorkspace(rel)
      const content = await fs.readFile(abs, 'utf-8')
      return { ok: true, content }
    },
  },
  {
    name: 'fs.read_dir',
    description: 'List directory entries (name, isDirectory, path)',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Workspace-relative path' } },
      required: ['path'],
      additionalProperties: false,
    },
    run: async ({ path: rel }: { path: string }) => {
      const abs = resolveWithinWorkspace(rel)
      const entries = await fs.readdir(abs, { withFileTypes: true })
      return {
        ok: true,
        entries: entries.map(e => ({ name: e.name, isDirectory: e.isDirectory(), path: path.join(rel, e.name) })),
      }
    },
  },
  {
    name: 'fs.write_file',
    description: 'Write a UTF-8 text file atomically inside the workspace',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    run: async ({ path: rel, content }: { path: string; content: string }) => {
      const abs = resolveWithinWorkspace(rel)



      await atomicWrite(abs, content)
      return { ok: true }
    },
  },
  {
    name: 'fs.create_dir',
    description: 'Create a directory inside the workspace (recursive by default)',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative directory path' },
        recursive: { type: 'boolean', default: true },
      },
      required: ['path'],
      additionalProperties: false,
    },
    run: async ({ path: rel, recursive = true }: { path: string; recursive?: boolean }) => {
      const abs = resolveWithinWorkspace(rel)
      await fs.mkdir(abs, { recursive })
      return { ok: true }
    },
  },
  {
    name: 'fs.delete_dir',
    description: 'Delete a directory from the workspace (recursive, force by default). USE WITH CARE.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative directory path' },
        recursive: { type: 'boolean', default: true },
        force: { type: 'boolean', default: true },
      },
      required: ['path'],
      additionalProperties: false,
    },
    run: async ({ path: rel, recursive = true, force = true }: { path: string; recursive?: boolean; force?: boolean }) => {
      const abs = resolveWithinWorkspace(rel)
      await fs.rm(abs, { recursive, force })
      return { ok: true }
    },
  },
  {
    name: 'fs.delete_file',
    description: 'Delete a file from the workspace. If force=true, succeeds when the file is missing.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        force: { type: 'boolean', default: true },
      },
      required: ['path'],
      additionalProperties: false,
    },
    run: async ({ path: rel, force = true }: { path: string; force?: boolean }) => {
      const abs = resolveWithinWorkspace(rel)
      try { await fs.unlink(abs) } catch (e: any) {
        if (!force) throw e
      }
      return { ok: true }
    },
  },
  {
    name: 'fs.exists',
    description: 'Check if a workspace-relative path exists',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Workspace-relative path' } },
      required: ['path'],
      additionalProperties: false,
    },
    run: async ({ path: rel }: { path: string }) => {
      const abs = resolveWithinWorkspace(rel)
      try { await fs.access(abs); return { ok: true, exists: true } } catch { return { ok: true, exists: false } }
    },
  },
  {
    name: 'fs.stat',
    description: 'Get basic stat info for a workspace-relative path',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Workspace-relative path' } },
      required: ['path'],
      additionalProperties: false,
    },
    run: async ({ path: rel }: { path: string }) => {
      const abs = resolveWithinWorkspace(rel)
      const s = await fs.stat(abs)
      return { ok: true, isFile: s.isFile(), isDirectory: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs }
    },
  },
  {
    name: 'fs.append_file',
    description: 'Append UTF-8 text to a file in the workspace (creates file if missing)',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        content: { type: 'string', description: 'Text to append' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    run: async ({ path: rel, content }: { path: string; content: string }) => {
      const abs = resolveWithinWorkspace(rel)
      await fs.appendFile(abs, content, 'utf-8')
      return { ok: true }
    },
  },
  {
    name: 'fs.move',
    description: 'Move/rename a file or directory within the workspace',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source workspace-relative path' },
        to: { type: 'string', description: 'Destination workspace-relative path' },
        overwrite: { type: 'boolean', default: true },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    run: async ({ from, to, overwrite = true }: { from: string; to: string; overwrite?: boolean }) => {
      const src = resolveWithinWorkspace(from)
      const dst = resolveWithinWorkspace(to)
      if (overwrite) {
        try { await fs.rm(dst, { recursive: true, force: true }) } catch {}
      }
      await fs.rename(src, dst)
      return { ok: true }
    },
  },
  {
    name: 'fs.copy',
    description: 'Copy a file or directory within the workspace',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source workspace-relative path' },
        to: { type: 'string', description: 'Destination workspace-relative path' },
        recursive: { type: 'boolean', default: true },
        overwrite: { type: 'boolean', default: true },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    run: async ({ from, to, recursive = true, overwrite = true }: { from: string; to: string; recursive?: boolean; overwrite?: boolean }) => {
      const src = resolveWithinWorkspace(from)
      const dst = resolveWithinWorkspace(to)
      // Prefer fs.cp if available (Node 16.7+)
      const anyFs: any = fs as any
      if (overwrite) {
        try { await fs.rm(dst, { recursive: true, force: true }) } catch {}
      }
      if (typeof anyFs.cp === 'function') {
        await anyFs.cp(src, dst, { recursive, force: true })
      } else {
        // Fallback: try copyFile (files only)
        await fs.copyFile(src, dst)
      }
      return { ok: true }
    },
  },
  {
    name: 'fs.remove',
    description: 'Remove a file or directory from the workspace (recursive/force by default). USE WITH CARE.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path to remove' },
        recursive: { type: 'boolean', default: true },
        force: { type: 'boolean', default: true },
      },
      required: ['path'],
      additionalProperties: false,
    },
    run: async ({ path: rel, recursive = true, force = true }: { path: string; recursive?: boolean; force?: boolean }) => {
      const abs = resolveWithinWorkspace(rel)
      await fs.rm(abs, { recursive, force })
      return { ok: true }
    },
  },
  {
    name: 'fs.truncate_file',
    description: 'Truncate a file to zero length (optionally create if missing).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        create: { type: 'boolean', default: true },
      },
      required: ['path'],
      additionalProperties: false,
    },
    run: async ({ path: rel, create = true }: { path: string; create?: boolean }) => {
      const abs = resolveWithinWorkspace(rel)
      if (create) {
        await fs.writeFile(abs, '', 'utf-8')
      } else {
        await fs.truncate(abs, 0)
      }
      return { ok: true }
    },
  },
  {
    name: 'fs.truncate_dir',
    description: 'Empty a directory without deleting the directory itself (recursive remove of contents).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative directory path' },
        ensureExists: { type: 'boolean', default: true },
      },
      required: ['path'],
      additionalProperties: false,
    },
    run: async ({ path: rel, ensureExists = true }: { path: string; ensureExists?: boolean }) => {
      const abs = resolveWithinWorkspace(rel)
      if (ensureExists) {
        await fs.mkdir(abs, { recursive: true })
      }
      const entries = await fs.readdir(abs, { withFileTypes: true })
      await Promise.all(entries.map(async (e) => {
        const child = path.join(abs, e.name)
        await fs.rm(child, { recursive: true, force: true })
      }))
      return { ok: true }
    },
  },
  {
    name: 'edits.apply',
    description: 'Apply a list of precise edits (verify with TypeScript when possible)',
    parameters: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          items: {
            type: 'object',
            oneOf: [
              {
                type: 'object',
                properties: { type: { const: 'replaceOnce' }, path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } },
                required: ['type', 'path', 'oldText', 'newText'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { type: { const: 'insertAfterLine' }, path: { type: 'string' }, line: { type: 'integer' }, text: { type: 'string' } },
                required: ['type', 'path', 'line', 'text'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { type: { const: 'replaceRange' }, path: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' }, text: { type: 'string' } },
                required: ['type', 'path', 'start', 'end', 'text'],
                additionalProperties: false,
              },
            ],
          },
        },
        verify: { type: 'boolean', default: true },
        tsconfigPath: { type: 'string' },
      },
      required: ['edits'],
      additionalProperties: false,
    },
    run: async ({ edits, verify = true, tsconfigPath }: { edits: any[]; verify?: boolean; tsconfigPath?: string }) => {
      const res = await applyFileEditsInternal(edits, { verify, tsconfigPath })
      return res
    },
  },
  {
    name: 'index.search',
    description: 'Vector search the repository index for relevant code context',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, k: { type: 'integer', minimum: 1, maximum: 20 } },
      required: ['query'],
      additionalProperties: false,
    },
    run: async ({ query, k = 8 }: { query: string; k?: number }) => {
      try {
        const res = await getIndexer().search(query.slice(0, 2000), k)
        return { ok: true, ...res }
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) }
      }
    }


  },
  {
    name: 'terminal.run',
    description: 'Run a shell command non-interactively and return stdout/stderr. Applies risk gating for installs/deletes.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run' },
        cwd: { type: 'string', description: 'Working directory (workspace-relative or absolute)' },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 600000, description: 'Timeout in ms (default 120000)' },
        env: { type: 'object', additionalProperties: { type: 'string' } },
        shell: { type: 'string', description: 'Shell executable to use (optional)' },
        autoApproveEnabled: { type: 'boolean', description: 'Allow auto-approve of risky commands when confidence >= threshold' },
        autoApproveThreshold: { type: 'number', description: 'Confidence threshold for auto-approval' },
        confidence: { type: 'number', description: 'Model confidence in the action (0-1)' }
      },
      required: ['command'],
      additionalProperties: false,
    },
    run: async (
      args: {
        command: string
        cwd?: string
        timeoutMs?: number
        env?: Record<string, string>
        shell?: string
        autoApproveEnabled?: boolean
        autoApproveThreshold?: number
        confidence?: number
      },
      meta?: { requestId?: string }
    ) => {
      const sessionId = meta?.requestId || 'terminal'
      // Resolve cwd safely within workspace when relative
      const cwd = (() => {
        if (!args.cwd) return process.cwd()
        try {
          const root = path.resolve(process.env.APP_ROOT || process.cwd())
          const abs = path.isAbsolute(args.cwd) ? args.cwd : path.join(root, args.cwd)
          return abs
        } catch {
          return process.cwd()
        }
      })()

      const { risky, reason } = isRiskyCommand(args.command || '')
      await logEvent(sessionId, 'terminal_run_attempt', { command: args.command, cwd, risky, reason })
      if (risky) {
        const autoEnabled = !!args.autoApproveEnabled
        const threshold = typeof args.autoApproveThreshold === 'number' ? args.autoApproveThreshold : 1.1 // impossible by design
        const conf = typeof args.confidence === 'number' ? args.confidence : -1
        const shouldAutoApprove = autoEnabled && conf >= threshold
        if (!shouldAutoApprove) {
          await logEvent(sessionId, 'terminal_run_blocked', { command: args.command, reason, confidence: conf, threshold })
          return { ok: false, blocked: true, reason }
        } else {
          await logEvent(sessionId, 'terminal_run_auto_approved', { command: args.command, reason, confidence: conf, threshold })
        }
      }

      const start = Date.now()
      try {
        const { stdout, stderr } = await exec(args.command, {
          cwd,
          env: { ...process.env, ...(args.env || {}) },
          shell: args.shell || (process.platform === 'win32' ? 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : (process.env.SHELL || '/bin/bash')),
          timeout: Math.max(1000, Math.min(600000, args.timeoutMs || 120000)),
          maxBuffer: 5 * 1024 * 1024,
        } as any)
        const outR = redactOutput((stdout || '').toString())
        const errR = redactOutput((stderr || '').toString())
        const durationMs = Date.now() - start
        await logEvent(sessionId, 'terminal_run_result', { command: args.command, exitCode: 0, durationMs, bytesRedacted: outR.bytesRedacted + errR.bytesRedacted })
        return { ok: true, exitCode: 0, stdout: outR.redacted, stderr: errR.redacted, durationMs }
      } catch (e: any) {
        const outR = redactOutput((e?.stdout || '').toString())
        const errR = redactOutput((e?.stderr || '').toString())
        const code = typeof e?.code === 'number' ? e.code : (e?.killed ? -1 : 1)
        const timedOut = !!e?.killed || /timed out|ETIMEDOUT/i.test(e?.message || '')
        const durationMs = Date.now() - start
        await logEvent(sessionId, 'terminal_run_result', { command: args.command, exitCode: code, timedOut, durationMs, error: e?.message, bytesRedacted: outR.bytesRedacted + errR.bytesRedacted })
        return { ok: false, exitCode: code, timedOut, error: e?.message || String(e), stdout: outR.redacted, stderr: errR.redacted, durationMs }
      }
    }


  },
  {
    name: 'terminal.session_present',
    description: 'Present a reusable terminal session bound to the agent request. Returns metadata and tiny tails; does not stream large output.',
    parameters: {
      type: 'object',
      properties: {
        ensureCwd: { type: 'string', description: 'Optional desired working directory (workspace-relative or absolute)' },
        shell: { type: 'string' },
        cols: { type: 'integer', minimum: 20, maximum: 400 },
        rows: { type: 'integer', minimum: 10, maximum: 200 }
      },
      additionalProperties: false,
    },
    run: async (
      args: { ensureCwd?: string; shell?: string; cols?: number; rows?: number },
      meta?: { requestId?: string }
    ) => {
      const req = meta?.requestId || 'terminal'
      const root = path.resolve(process.env.APP_ROOT || process.cwd())
      const desiredCwd = args.ensureCwd ? (path.isAbsolute(args.ensureCwd) ? args.ensureCwd : path.join(root, args.ensureCwd)) : undefined
      const sid = await (globalThis as any).__getOrCreateAgentPtyFor(req, { shell: args.shell, cwd: desiredCwd, cols: args.cols, rows: args.rows })
      const rec = (globalThis as any).__agentPtySessions.get(sid)
      if (!rec) return { ok: false, error: 'no-session' }

      // Attach current window so that output goes to the visible terminal immediately
      try {
        const wc = getWebContents()
        if (wc) rec.attachedWcIds.add(wc.id)
      } catch {}

      const state = rec.state
      const lastCmds = state.commands.slice(-5).map((c: any) => ({ id: c.id, command: c.command.slice(0, 200), startedAt: c.startedAt, endedAt: c.endedAt, bytes: c.bytes, tail: c.data.slice(-200) }))
      return {
        ok: true,
        sessionId: sid,
        shell: rec.shell,
        cwd: rec.cwd,
        cols: rec.cols,
        rows: rec.rows,
        commandCount: state.commands.length,
        lastCommands: lastCmds,
        liveTail: state.ring.slice(-400)
      }
    }
  },
  {
    name: 'terminal.session_exec',
    description: 'Write a command to the presented terminal (adds a newline). Records output into a new command record. Risk gating applies to destructive installs/deletes.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        autoApproveEnabled: { type: 'boolean' },
        autoApproveThreshold: { type: 'number' },
        confidence: { type: 'number' }
      },
      required: ['command'],
      additionalProperties: false,
    },
    run: async (
      args: { command: string; autoApproveEnabled?: boolean; autoApproveThreshold?: number; confidence?: number },
      meta?: { requestId?: string }
    ) => {
      const req = meta?.requestId || 'terminal'
      const sid = await (globalThis as any).__getOrCreateAgentPtyFor(req)
      const rec = (globalThis as any).__agentPtySessions.get(sid)
      if (!rec) return { ok: false, error: 'no-session' }

      // Ensure the calling window is attached so output streams to the visible terminal
      try {
        const wc = getWebContents()
        if (wc) rec.attachedWcIds.add(wc.id)
      } catch {}

      const { risky, reason } = isRiskyCommand(args.command)
      await logEvent(sid, 'agent_pty_command_attempt', { command: args.command, risky, reason })
      if (risky) {
        const autoEnabled = !!args.autoApproveEnabled
        const threshold = typeof args.autoApproveThreshold === 'number' ? args.autoApproveThreshold : 1.1
        const conf = typeof args.confidence === 'number' ? args.confidence : -1
        if (!(autoEnabled && conf >= threshold)) {
          await logEvent(sid, 'agent_pty_command_blocked', { command: args.command, reason, confidence: conf, threshold })
          return { ok: false, blocked: true, reason }
        }
      }
      await (globalThis as any).__beginAgentCommand(rec.state, args.command)
      try {
        rec.p.write(args.command + (process.platform === 'win32' ? '\r\n' : '\n'))
        return { ok: true, sessionId: sid }
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) }
      }
    }
  },
  {
    name: 'terminal.session_search_output',
    description: 'Search the session\'s captured command outputs and/or live buffer for a substring; returns compact snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        caseSensitive: { type: 'boolean' },
        in: { type: 'string', enum: ['commands','live','all'], default: 'all' },
        maxResults: { type: 'integer', minimum: 1, maximum: 200, default: 30 }
      },
      required: ['query'],
      additionalProperties: false,
    },
    run: async (
      args: { query: string; caseSensitive?: boolean; in?: 'commands'|'live'|'all'; maxResults?: number },
      meta?: { requestId?: string }
    ) => {
      const req = meta?.requestId || 'terminal'
      const sid = (globalThis as any).__agentPtyAssignments.get(req)
      const rec = sid ? (globalThis as any).__agentPtySessions.get(sid) : undefined
      if (!sid || !rec) return { ok: false, error: 'no-session' }
      const st = rec.state
      const q = args.caseSensitive ? args.query : args.query.toLowerCase()
      const max = Math.min(200, Math.max(1, args.maxResults || 30))
      const where = args.in || 'all'
      const results: any[] = []
      function findIn(text: string, source: any) {
        const hay = args.caseSensitive ? text : text.toLowerCase()
        let idx = 0
        while (results.length < max) {
          const pos = hay.indexOf(q, idx)
          if (pos === -1) break
          const start = Math.max(0, pos - 80)
          const end = Math.min(text.length, pos + q.length + 80)
          const snippet = text.slice(start, end)
          results.push({ ...source, pos, snippet })
          idx = pos + q.length
        }
      }
      if (where === 'all' || where === 'commands') {
        for (let i = st.commands.length - 1; i >= 0 && results.length < max; i--) {
          const c = st.commands[i]
          findIn(c.data, { type: 'command', id: c.id, command: c.command.slice(0, 200), startedAt: c.startedAt, endedAt: c.endedAt })
        }
      }
      if (where === 'all' || where === 'live') {
        findIn(st.ring, { type: 'live' })
      }
      return { ok: true, sessionId: sid, hits: results }
    }
  },
  {
    name: 'terminal.session_tail',
    description: 'Return the last part of the live buffer (small tail only) to inspect recent output without flooding tokens.',
    parameters: {
      type: 'object',
      properties: { maxBytes: { type: 'integer', minimum: 100, maximum: 10000, default: 2000 } },
      additionalProperties: false,
    },
    run: async (args: { maxBytes?: number }, meta?: { requestId?: string }) => {
      const req = meta?.requestId || 'terminal'
      const sid = (globalThis as any).__agentPtyAssignments.get(req)
      const rec = sid ? (globalThis as any).__agentPtySessions.get(sid) : undefined
      if (!sid || !rec) return { ok: false, error: 'no-session' }
      const n = Math.max(100, Math.min(10000, args.maxBytes || 2000))
      const tail = rec.state.ring.slice(-n)
      const { redacted } = redactOutput(tail)
      return { ok: true, sessionId: sid, tail: redacted }
    }
  },
  {
    name: 'terminal.session_restart',
    description: 'Restart the presented terminal session (kills and recreates).',
    parameters: { type: 'object', properties: { shell: { type: 'string' }, cwd: { type: 'string' }, cols: { type: 'integer' }, rows: { type: 'integer' } }, additionalProperties: false },
    run: async (args: { shell?: string; cwd?: string; cols?: number; rows?: number }, meta?: { requestId?: string }) => {
      const req = meta?.requestId || 'terminal'
      const old = (globalThis as any).__agentPtyAssignments.get(req)
      if (old) {
        try { (globalThis as any).__agentPtySessions.get(old)?.p.kill() } catch {}
        (globalThis as any).__agentPtySessions.delete(old)
      }
      const root = path.resolve(process.env.APP_ROOT || process.cwd())
      const desiredCwd = args.cwd ? (path.isAbsolute(args.cwd) ? args.cwd : path.join(root, args.cwd)) : undefined
      const tmpSid = await (globalThis as any).__createAgentPtySession({ shell: args.shell, cwd: desiredCwd, cols: args.cols, rows: args.rows }) as string
      ;(globalThis as any).__agentPtyAssignments.set(req, tmpSid)
      return { ok: true, sessionId: tmpSid }
    }
  },
  {
    name: 'terminal.session_close',
    description: 'Close the presented terminal session and clear assignment.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: async (_args: {}, meta?: { requestId?: string }) => {
      const req = meta?.requestId || 'terminal'
      const sid = (globalThis as any).__agentPtyAssignments.get(req)
      if (!sid) return { ok: true }
      try { (globalThis as any).__agentPtySessions.get(sid)?.p.kill() } catch {}
      (globalThis as any).__agentPtySessions.delete(sid)
      (globalThis as any).__agentPtyAssignments.delete(req)
      return { ok: true }
    }
  },
  {
    name: 'code.search_ast',
    description: 'Structural AST search using @ast-grep/napi (inline patterns only)',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'ast-grep inline pattern, e.g., console.log($VAL)' },
        languages: { type: 'array', items: { type: 'string' }, description: "Optional languages. Use 'auto' by file extension if omitted" },
        includeGlobs: { type: 'array', items: { type: 'string' } },
        excludeGlobs: { type: 'array', items: { type: 'string' } },
        maxMatches: { type: 'integer', minimum: 1, maximum: 5000, default: 500 },
        contextLines: { type: 'integer', minimum: 0, maximum: 20, default: 2 },
        maxFileBytes: { type: 'integer', minimum: 1, default: 1000000 },
        concurrency: { type: 'integer', minimum: 1, maximum: 32, default: 6 },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    run: async (args: { pattern: string; languages?: string[]; includeGlobs?: string[]; excludeGlobs?: string[]; maxMatches?: number; contextLines?: number; maxFileBytes?: number; concurrency?: number }) => {
      try {
        const res = await astGrepSearch({
          pattern: args.pattern,
          languages: (args.languages && args.languages.length) ? args.languages : 'auto',
          includeGlobs: args.includeGlobs,
          excludeGlobs: args.excludeGlobs,
          maxMatches: args.maxMatches,
          contextLines: args.contextLines,
          maxFileBytes: args.maxFileBytes,
          concurrency: args.concurrency,
        })
        return { ok: true, ...res }
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) }
      }
    },
  },
  {
    name: 'code.apply_edits_targeted',
    description: 'Apply targeted edits: simple text edits and/or cross-language AST rewrites via ast-grep. Supports dryRun and ranges-only modes.',
    parameters: {
      type: 'object',
      properties: {
        textEdits: {
          type: 'array',
          items: {
            type: 'object',
            oneOf: [
              {
                type: 'object',
                properties: { type: { const: 'replaceOnce' }, path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } },
                required: ['type', 'path', 'oldText', 'newText'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { type: { const: 'insertAfterLine' }, path: { type: 'string' }, line: { type: 'integer' }, text: { type: 'string' } },
                required: ['type', 'path', 'line', 'text'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { type: { const: 'replaceRange' }, path: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' }, text: { type: 'string' } },
                required: ['type', 'path', 'start', 'end', 'text'],
                additionalProperties: false,
              },
            ],
          },
        },
        astRewrites: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
              rewrite: { type: 'string' },
              languages: { type: 'array', items: { type: 'string' } },
              includeGlobs: { type: 'array', items: { type: 'string' } },
              excludeGlobs: { type: 'array', items: { type: 'string' } },
              perFileLimit: { type: 'integer', minimum: 1, maximum: 1000 },
              totalLimit: { type: 'integer', minimum: 1, maximum: 100000 },
              maxFileBytes: { type: 'integer', minimum: 1 },
              concurrency: { type: 'integer', minimum: 1, maximum: 32 },
            },
            required: ['pattern', 'rewrite'],
            additionalProperties: false,
          },
        },
        advancedTextEdits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              guard: {
                type: 'object',
                properties: { expectedBefore: { type: 'string' }, checksum: { type: 'string' } },
                additionalProperties: false
              },
              selector: {
                oneOf: [
                  { type: 'object', properties: { range: { type: 'object', properties: { start: { type: 'object', properties: { line: { type: 'integer' }, column: { type: 'integer' } }, required: ['line','column'] }, end: { type: 'object', properties: { line: { type: 'integer' }, column: { type: 'integer' } }, required: ['line','column'] } }, required: ['start','end'] } }, required: ['range'] },
                  { type: 'object', properties: { anchors: { type: 'object', properties: { before: { type: 'string' }, after: { type: 'string' }, occurrence: { type: 'integer', minimum: 1 } } } }, required: ['anchors'] },
                  { type: 'object', properties: { regex: { type: 'object', properties: { pattern: { type: 'string' }, flags: { type: 'string' }, occurrence: { type: 'integer', minimum: 1 } }, required: ['pattern'] } }, required: ['regex'] },
                  { type: 'object', properties: { structuralMatch: { type: 'object', properties: { file: { type: 'string' }, start: { type: 'object', properties: { line: { type: 'integer' }, column: { type: 'integer' } }, required: ['line','column'] }, end: { type: 'object', properties: { line: { type: 'integer' }, column: { type: 'integer' } }, required: ['line','column'] } }, required: ['file','start','end'] } }, required: ['structuralMatch'] }
                ]
              },
              action: {
                oneOf: [
                  { type: 'object', properties: { 'text.replace': { type: 'object', properties: { newText: { type: 'string' } }, required: ['newText'] } }, required: ['text.replace'] },
                  { type: 'object', properties: { 'text.insert': { type: 'object', properties: { position: { enum: ['before','after','start','end'] }, text: { type: 'string' } }, required: ['position','text'] } }, required: ['text.insert'] },
                  { type: 'object', properties: { 'text.delete': { type: 'object' } }, required: ['text.delete'] },
                  { type: 'object', properties: { 'text.wrap': { type: 'object', properties: { prefix: { type: 'string' }, suffix: { type: 'string' } }, required: ['prefix','suffix'] } }, required: ['text.wrap'] }
                ]
              }
            },
            required: ['path','selector','action'],
            additionalProperties: false
          }
        },
        dryRun: { type: 'boolean', default: false },
        rangesOnly: { type: 'boolean', default: false },
        verify: { type: 'boolean', default: true },
        tsconfigPath: { type: 'string' }
      },
      additionalProperties: false,
    },
    run: async (args: { textEdits?: any[]; astRewrites?: any[]; advancedTextEdits?: any[]; dryRun?: boolean; rangesOnly?: boolean; verify?: boolean; tsconfigPath?: string }) => {
      const dryRun = !!args.dryRun
      const rangesOnly = !!args.rangesOnly
      const verify = args.verify !== false
      const textEdits = Array.isArray(args.textEdits) ? args.textEdits : []
      const astOps = Array.isArray(args.astRewrites) ? args.astRewrites : []
      const advOps = Array.isArray(args.advancedTextEdits) ? args.advancedTextEdits : []
      try {
        const resText = textEdits.length ? await applyFileEditsInternal(textEdits, { dryRun, verify: false }) : { applied: 0, results: [] as any[] }
        const astResults: any[] = []
        let astApplied = 0
        for (const op of astOps) {
          const r = await astGrepRewrite({
            pattern: op.pattern,
            rewrite: op.rewrite,
            languages: (op.languages && op.languages.length) ? op.languages : 'auto',
            includeGlobs: op.includeGlobs,
            excludeGlobs: op.excludeGlobs,
            perFileLimit: op.perFileLimit,
            totalLimit: op.totalLimit,
            maxFileBytes: op.maxFileBytes,
            concurrency: op.concurrency,
            dryRun,
            rangesOnly,
          })
          astResults.push(r)
          astApplied += r.changes.reduce((acc, c) => acc + (c.applied ? c.count : 0), 0)
        }

        // Advanced text edits
        const advResults: any[] = []
        let advApplied = 0
        const byFile: Record<string, any[]> = {}
        for (const ed of advOps) {
          if (!byFile[ed.path]) byFile[ed.path] = []
          byFile[ed.path].push(ed)
        }
        const crypto = await import('node:crypto')
        for (const [p, ops] of Object.entries(byFile)) {
          const abs = resolveWithinWorkspace(p)
          let content = ''
          try { content = await fs.readFile(abs, 'utf-8') } catch { advResults.push({ path: p, changed: false, message: 'read-failed' }); continue }
          const origChecksum = crypto.createHash('sha1').update(content, 'utf8').digest('hex')
          let changed = false
          const lines = content.split(/\r?\n/)
          const idx: number[] = [0]; for (let i=0;i<lines.length;i++) idx.push(idx[i] + lines[i].length + 1)
          function off(line1: number, col1: number) { const l0 = Math.max(0, Math.min(idx.length-2, (line1|0)-1)); return idx[l0] + Math.max(0, (col1|0)-1) }

          for (const op of ops) {
            // Resolve selection
            let s = 0, e = 0
            if (op.selector?.range) {
              s = off(op.selector.range.start.line, op.selector.range.start.column)
              e = off(op.selector.range.end.line, op.selector.range.end.column)
            } else if (op.selector?.anchors) {
              const before = op.selector.anchors.before || ''
              const after = op.selector.anchors.after || ''
              const occ = Math.max(1, op.selector.anchors.occurrence || 1)
              if (before) {
                let pos = -1, from = 0
                for (let i=0;i<occ;i++) { pos = content.indexOf(before, from); if (pos === -1) break; from = pos + before.length }
                if (pos !== -1) s = pos + before.length
              }
              if (after) {
                const pos = content.indexOf(after, s)
                if (pos !== -1) e = pos
              } else { e = s }
            } else if (op.selector?.regex) {
              const re = new RegExp(op.selector.regex.pattern, op.selector.regex.flags || 'g')
              const occ = Math.max(1, op.selector.regex.occurrence || 1)
              let m: RegExpExecArray | null = null
              let count = 0
              while ((m = re.exec(content))) { count++; if (count === occ) { s = m.index; e = m.index + m[0].length; break } if (!re.global) break }
            } else if (op.selector?.structuralMatch) {
              s = off(op.selector.structuralMatch.start.line, op.selector.structuralMatch.start.column)
              e = off(op.selector.structuralMatch.end.line, op.selector.structuralMatch.end.column)
            } else {
              advResults.push({ path: p, changed: false, message: 'bad-selector' }); continue
            }

            const selected = content.slice(s, e)
            // Guards
            if (op.guard?.expectedBefore && !selected.includes(op.guard.expectedBefore)) { advResults.push({ path: p, changed: false, message: 'guard-mismatch' }); continue }
            if (op.guard?.checksum && op.guard.checksum !== origChecksum) { advResults.push({ path: p, changed: false, message: 'stale-file' }); continue }

            // Action
            let next = content
            if (op.action['text.replace']) {
              next = content.slice(0, s) + op.action['text.replace'].newText + content.slice(e)
            } else if (op.action['text.insert']) {
              const pos = op.action['text.insert'].position
              const ins = op.action['text.insert'].text
              if (pos === 'before') next = content.slice(0, s) + ins + content.slice(s)
              else if (pos === 'after') next = content.slice(0, e) + ins + content.slice(e)
              else if (pos === 'start') next = ins + content
              else next = content + ins
            } else if (op.action['text.delete']) {
              next = content.slice(0, s) + content.slice(e)
            } else if (op.action['text.wrap']) {
              const pre = op.action['text.wrap'].prefix, suf = op.action['text.wrap'].suffix
              next = content.slice(0, s) + pre + selected + suf + content.slice(e)
            } else {
              advResults.push({ path: p, changed: false, message: 'bad-action' }); continue
            }

            const start = (()=>{ // recalc start/end lines
              const lines2 = content.slice(0, s).split(/\r?\n/); return { line: lines2.length, column: lines2[lines2.length-1].length + 1 }
            })()
            const end = (()=>{ const lines2 = content.slice(0, e).split(/\r?\n/); return { line: lines2.length, column: lines2[lines2.length-1].length + 1 } })()
            advResults.push({ path: p, changed: !dryRun && !rangesOnly && next !== content, ranges: [{ startLine: start.line, startCol: start.column, endLine: end.line, endCol: end.column }] })
            if (!dryRun && !rangesOnly && next !== content) { content = next; changed = true }
          }

          if (!dryRun && !rangesOnly && changed) {
            await atomicWrite(abs, content)
            advApplied += 1
          }
        }

        let verification: any = undefined
        if (verify && !dryRun && !rangesOnly) {
          try { verification = tsVerify(args.tsconfigPath) } catch {}
        }
        return {
          ok: true,
          applied: (resText.applied || 0) + astApplied + advApplied,
          results: [
            ...(resText.results || []),
            ...astResults.flatMap((r) => r.changes.map((c: any) => ({ path: c.filePath, changed: !!c.applied, ranges: c.ranges, count: c.count }))),
            ...advResults
          ],
          dryRun,
          rangesOnly,
          verification,
        }
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) }
      }
    },
  }
];// Expose agent tools via globalThis for llm-agent module
;(globalThis as any).__agentTools = agentTools

// ============================================================================
// APPLICATION INITIALIZATION
// ============================================================================

/**
 * Initialize the application
 */
function initialize(): void {
  // Register all IPC handlers
  registerAllHandlers(ipcMain)

  // Register rate limit IPC handlers
  registerRateLimitIpc(ipcMain)

  // Initialize agent session cleanup
  initAgentSessionsCleanup()

  // Initialize app lifecycle and create window
  initializeApp(() => {
    // Build menu after window is created
    buildMenu()
  })

  console.log('[main] HiFide initialized successfully')
  console.log('[main] Agent tools registered:', agentTools.length)
}

// Start the application
initialize()

