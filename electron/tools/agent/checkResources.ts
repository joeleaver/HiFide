/**
 * agent.check_resources tool
 * 
 * Check current token usage and remaining budget.
 */

import type { AgentTool } from '../../providers/provider'
import { getOrCreateSession } from '../../session/agentSessions'
import { getResourceRecommendation } from '../../agent/types'

export const checkResourcesTool: AgentTool = {
  name: 'agentCheckResources',
  description: 'Check token usage and budget.',
  parameters: {
    type: 'object',
    properties: {},
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
}

