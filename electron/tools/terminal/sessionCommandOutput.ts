import type { AgentTool } from '../../providers/provider'
import { getSessionService } from '../../services/index.js'
import * as agentPty from '../../services/agentPty'
import { sanitizeTerminalOutput, redactOutput } from '../utils'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export const sessionCommandOutputTool: AgentTool = {
  name: 'terminalSessionCommandOutput',
  description: [
    'Fetch buffered output for a prior terminalExec command by ID.',
    'terminalExec now blocks up to 60s and returns at most 500 lines, responding with a long-running message when more output remains.',
    'Call this tool when you receive that message and use offset/maxBytes to page deterministically through the remaining log.'
  ].join('\n'),
  parameters: {
    type: 'object',
    properties: {
      commandId: { type: 'integer', minimum: 1, description: 'Command identifier returned by terminalExec' },
      offset: {
        type: 'integer',
        minimum: 0,
        default: 0,
        description: 'Character offset (from start of command output) to begin returning data'
      },
      maxBytes: {
        type: 'integer',
        minimum: 200,
        maximum: 20000,
        default: 4000,
        description: 'Maximum bytes/characters of output to return in this chunk'
      }
    },
    required: ['commandId'],
    additionalProperties: false,
  },
  run: async (
    args: { commandId: number; offset?: number; maxBytes?: number },
    meta?: { requestId?: string; workspaceId?: string }
  ) => {
    const sessionService = getSessionService()
    const ws = meta?.workspaceId || null
    const sessionId = ws ? sessionService.getCurrentIdFor({ workspaceId: ws }) : null
    if (!sessionId) {
      console.error('[terminal.session_command_output] No active sessionId')
      return { ok: false, error: 'no-session' }
    }

    const rec = agentPty.getSessionRecord(sessionId)
    if (!rec) {
      console.error('[terminal.session_command_output] No session record found for sessionId:', sessionId)
      return { ok: false, error: 'no-session' }
    }

    const cmd = rec.state.commands.find((c) => c.id === args.commandId)
    if (!cmd) {
      return { ok: false, error: 'command-not-found' }
    }

    const totalChars = cmd.data.length
    const offset = clamp(Math.floor(args.offset ?? 0), 0, totalChars)
    const maxBytes = clamp(Math.floor(args.maxBytes ?? 4000), 200, 20000)
    const end = clamp(offset + maxBytes, offset, totalChars)
    const rawChunk = cmd.data.slice(offset, end)
    const sanitized = sanitizeTerminalOutput(rawChunk)
    const { redacted } = redactOutput(sanitized)

    return {
      ok: true,
      sessionId,
      commandId: cmd.id,
      chunk: redacted,
      offset,
      endOffset: end,
      totalChars,
      bytes: cmd.bytes,
      commandComplete: Boolean(cmd.endedAt),
      hasMoreBefore: offset > 0,
      hasMoreAfter: end < totalChars,
    }
  }
}
