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
  name: 'agentAssessTask',
  description: 'Assess task scope and get resource budget.',
  parameters: {
    type: 'object',
    properties: {
      task_type: {
        type: 'string',
        enum: ['simple_query', 'file_edit', 'multi_file_refactor', 'codebase_audit', 'exploration'],
      },
      estimated_files: { type: 'number' },
      estimated_iterations: { type: 'number' },
      strategy: { type: 'string' },
    },
    required: ['task_type', 'estimated_files', 'estimated_iterations', 'strategy'],
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

