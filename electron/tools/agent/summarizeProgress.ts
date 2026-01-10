/**
 * agent.summarize_progress tool
 * 
 * Summarize what has been learned so far to compress context.
 */

import type { AgentTool } from '../../providers/provider'
import { getOrCreateSession } from '../../session/agentSessions'

export const summarizeProgressTool: AgentTool = {
  name: 'agentSummarizeProgress',
  description: 'Summarize progress to compress context.',
  parameters: {
    type: 'object',
    properties: {
      key_findings: { type: 'array', items: { type: 'string' } },
      files_examined: { type: 'array', items: { type: 'string' } },
      next_steps: { type: 'array', items: { type: 'string' } },
    },
    required: ['key_findings', 'files_examined', 'next_steps'],
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

