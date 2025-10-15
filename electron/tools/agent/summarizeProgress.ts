/**
 * agent.summarize_progress tool
 * 
 * Summarize what has been learned so far to compress context.
 */

import type { AgentTool } from '../../providers/provider'
import { getOrCreateSession } from '../../session/agentSessions'

export const summarizeProgressTool: AgentTool = {
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
}

