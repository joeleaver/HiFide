/**
 * agent.assess_task tool
 * 
 * Analyze the user request to determine scope and plan approach.
 */

import type { AgentTool } from '../../providers/provider'
import { getOrCreateSession } from '../../session/agentSessions'
import type { TaskType } from '../../agent/types'
import { calculateBudget } from '../../agent/types'

export const assessTaskTool: AgentTool = {
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

    const assessment = {
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
}

