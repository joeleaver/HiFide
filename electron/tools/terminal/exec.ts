import type { AgentTool } from '../../providers/provider'
import type { AgentPtyRecord } from '../../services/agentPty'
import { getSessionService } from '../../services/index.js'
import * as agentPty from '../../services/agentPty'
import { sanitizeTerminalOutput, redactOutput } from '../utils'

const COMMAND_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 100
const MAX_OUTPUT_LINES = 500
const LONG_RUNNING_MESSAGE = 'Command is long running and still in progress, use terminalSessionCommandOutput to see current state'
const PROMPT_SNAPSHOT_WINDOW = 2_000
const PROMPT_TAIL_WINDOW = 1_200
const PROMPT_STABLE_MS = 150
const PROMPT_REGEXES = [
  /\nPS [^\n]*> $/i,
  /\n[A-Z]:\\[^\n]*> $/,
  /\n[\w.@~\-/\s]+[$#%] $/,
  /\n[$#%] $/,
  /\n(?!>> )> $/,
  /\n[^\n]{0,160}[❯➜➝➞➟➠➢➣➤➥➦➧➨➩➪➫➬➭➮➯➱➲➳➵➸➺➻➼➽➾⚡λƒπΣΦΩ✗✘✖✕×╳✓✔»›⋗⋙] $/u,
]

const PROMPT_STATUS_MARKERS = /[✗✘✖✕×╳⚠‼!]+\s*$/u

type AgentCommand = AgentPtyRecord['state']['commands'][number]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const normalizeNewlines = (value: string): string => value.replace(/\r\n/g, '\n')

const getLatestCommand = (rec: AgentPtyRecord): AgentCommand | null => {
  const { commands, activeIndex } = rec.state
  if (activeIndex != null && commands[activeIndex]) return commands[activeIndex]
  return commands.length > 0 ? commands[commands.length - 1] : null
}

const getCommandById = (rec: AgentPtyRecord, commandId: number): AgentCommand | null => {
  return rec.state.commands.find((cmd) => cmd.id === commandId) ?? null
}

const getLastNonEmptyLine = (block: string): string | null => {
  if (!block) return null
  const lines = block.split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const candidate = lines[i]
    if (candidate && candidate.trim().length > 0) {
      return candidate
    }
  }
  return null
}

const getPromptSnapshot = (ring: string): string | null => {
  if (!ring) return null
  const windowed = ring.slice(-PROMPT_SNAPSHOT_WINDOW)
  const sanitized = normalizeNewlines(sanitizeTerminalOutput(windowed))
  if (!sanitized) return null
  return getLastNonEmptyLine(sanitized)
}

const stripPromptStatusMarkers = (line: string): string => line.replace(PROMPT_STATUS_MARKERS, '').trimEnd()

const buildPromptSignature = (line: string): string | null => {
  if (!line) return null
  const withoutMarkers = stripPromptStatusMarkers(line)
  const signature = withoutMarkers
    .replace(/[^A-Za-z0-9_./\\:@~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return signature || null
}

const hasPromptReturned = (
  cmd: AgentCommand,
  expectedPrompt?: string | null,
  expectedSignature?: string | null,
): boolean => {
  if (!cmd?.data) return false
  const tail = normalizeNewlines(sanitizeTerminalOutput(cmd.data.slice(-PROMPT_TAIL_WINDOW)))
  if (!tail) return false
  if (expectedPrompt && tail.endsWith(expectedPrompt)) return true
  const lastLine = getLastNonEmptyLine(tail)
  if (expectedSignature && lastLine) {
    const candidateSignature = buildPromptSignature(lastLine)
    if (candidateSignature && candidateSignature === expectedSignature) return true
  }
  return PROMPT_REGEXES.some((regex) => regex.test(tail))
}

const normalizeCommand = (command: string): string => {
  const isWin = process.platform === 'win32'
  const EOL = isWin ? '\r\n' : '\n'
  return command
    .replace(/\r\n?|\n/g, EOL)
    .replace(/[\u2028\u2029]/g, EOL)
    .trimEnd()
}

const buildPayload = (command: string): string => {
  const normalized = normalizeCommand(command)
  if (process.platform === 'win32') {
    const BP_START = '\u001b[200~'
    const BP_END = '\u001b[201~'
    const ENTER = '\r'
    return `${BP_START}${normalized}${BP_END}${ENTER}`
  }
  return `${normalized}\n`
}

const maybeRecoverWindowsContinuation = async (rec: AgentPtyRecord, sessionId: string): Promise<void> => {
  if (process.platform !== 'win32') return
  try {
    await sleep(60)
    const tail = String(rec.state.ring).slice(-200)
    const inContinuation = /\n>> $/.test(tail) && !/\nPS [^\n]*> $/.test(tail)
    if (inContinuation) {
      agentPty.write(sessionId, '\u0003') // Ctrl+C
    }
  } catch {}
}

type WaitForCommandOptions = {
  commandId: number
  expectedPrompt?: string | null
  expectedPromptSignature?: string | null
}

const waitForCommand = async (rec: AgentPtyRecord, opts: WaitForCommandOptions): Promise<void> => {
  const start = Date.now()
  let lastLength = 0
  let lastChangeAt = Date.now()
  while (Date.now() - start < COMMAND_TIMEOUT_MS) {
    const active = getCommandById(rec, opts.commandId)
    if (!active) return
    if (active.endedAt) return

    const currentLength = active.data.length
    if (currentLength !== lastLength) {
      lastLength = currentLength
      lastChangeAt = Date.now()
    }

    const promptRestored = hasPromptReturned(active, opts.expectedPrompt, opts.expectedPromptSignature)
    const idleLongEnough = Date.now() - lastChangeAt > PROMPT_STABLE_MS
    if (promptRestored && idleLongEnough) {
      active.endedAt = active.endedAt ?? Date.now()
      if (rec.state.activeIndex != null && rec.state.commands[rec.state.activeIndex]?.id === active.id) {
        rec.state.activeIndex = null
      }
      return
    }

    await sleep(POLL_INTERVAL_MS)
  }
}

const sanitizeLines = (raw: string): { lines: string[]; totalChars: number } => {
  const sanitized = sanitizeTerminalOutput(raw)
  const { redacted } = redactOutput(sanitized)
  const normalized = redacted.replace(/\r\n/g, '\n')
  if (!normalized) return { lines: [], totalChars: 0 }
  const split = normalized.split('\n')
  const hasTrailingBlank = split.length > 0 && split[split.length - 1] === ''
  const lines = hasTrailingBlank ? split.slice(0, -1) : split
  return { lines, totalChars: normalized.length }
}

export const terminalExecTool: AgentTool = {
  name: 'terminalExec',
  description: [
    'Execute a command inside the shared agent terminal. The PTY session is visible in the UI and reused between calls.',
    'The tool blocks for up to 60 seconds (or until the command exits) and then returns the full output, capped at 500 lines.',
    'If the output exceeds 500 lines or the command is still running after 60 seconds, the tool responds with "Command is long running and still in progress, use terminalSessionCommandOutput to see current state" plus a preview.',
  ].join('\n'),
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  run: async (args: { command: string }, meta?: { requestId?: string; workspaceId?: string }) => {
    try {
      const rawCommand = typeof args.command === 'string' ? args.command : ''
      if (!rawCommand.trim()) {
        return { ok: false, error: 'empty-command' }
      }

      const sessionService = getSessionService()
      const workspaceId = meta?.workspaceId || null
      const sessionId = workspaceId ? sessionService.getCurrentIdFor({ workspaceId }) : null
      if (!sessionId) {
        console.error('[terminal.exec] No active sessionId for workspace:', workspaceId)
        return { ok: false, error: 'no-session' }
      }

      const sid = await agentPty.getOrCreateAgentPtyFor(sessionId)
      const rec = agentPty.getSessionRecord(sid)
      if (!rec) {
        console.error('[terminal.exec] No PTY record for sessionId:', sid)
        return { ok: false, error: 'no-session' }
      }

      await agentPty.beginCommand(rec.state, rawCommand)
      const latestCommand = getLatestCommand(rec)
      if (!latestCommand) {
        return { ok: false, error: 'command-missing' }
      }

      const promptSnapshot = getPromptSnapshot(rec.state.ring)
      const promptSignature = promptSnapshot ? buildPromptSignature(promptSnapshot) : null

      agentPty.write(sid, buildPayload(rawCommand))

      await maybeRecoverWindowsContinuation(rec, sid)
      await waitForCommand(rec, {
        commandId: latestCommand.id,
        expectedPrompt: promptSnapshot,
        expectedPromptSignature: promptSignature,
      })

      const { lines, totalChars } = sanitizeLines(latestCommand.data)
      const truncated = lines.length > MAX_OUTPUT_LINES
      const previewLines = truncated ? lines.slice(-MAX_OUTPUT_LINES) : lines
      const preview = previewLines.join('\n')
      const commandFinished = Boolean(latestCommand.endedAt)
      const commandId = latestCommand.id
      const needsContinuation = truncated || !commandFinished

      if (!needsContinuation) {
        return {
          ok: true,
          sessionId: sid,
          commandId,
          commandFinished: true,
          lineCount: lines.length,
          output: preview,
          totalChars,
        }
      }

      return {
        ok: true,
        sessionId: sid,
        commandId,
        commandFinished,
        message: LONG_RUNNING_MESSAGE,
        preview,
        previewLineCount: previewLines.length,
        totalLines: lines.length,
        truncated,
        continuation: { tool: 'terminalSessionCommandOutput', commandId },
        totalChars,
      }
    } catch (error: any) {
      console.error('[terminal.exec] Error executing command:', error)
      return { ok: false, error: error?.message || String(error) }
    }
  },
}

export default terminalExecTool

export const __terminalExecInternals = {
  getPromptSnapshot,
  hasPromptReturned,
  buildPromptSignature,
}
