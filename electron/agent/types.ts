/**
 * Agent self-regulation types
 * 
 * These types support the agent's ability to manage its own resources,
 * plan tasks, and compress context when needed.
 */

export type TaskType = 
  | 'simple_query'      // Single file read, simple question
  | 'file_edit'         // Edit 1-3 files
  | 'multi_file_refactor' // Edit 4+ files, refactoring
  | 'codebase_audit'    // Analyze entire codebase
  | 'exploration'       // Understand codebase structure

export interface TaskAssessment {
  task_type: TaskType
  estimated_files: number
  estimated_iterations: number
  strategy: string
  token_budget: number
  max_iterations: number
  timestamp: number
}

export interface ResourceStats {
  tokens_used: number
  tokens_budget: number
  tokens_remaining: number
  percentage_used: number
  iterations_used: number
  iterations_max: number
  iterations_remaining: number
}

export interface ProgressSummary {
  key_findings: string[]
  files_examined: string[]
  next_steps: string[]
  timestamp: number
}

export interface ExploredItem {
  type: 'file' | 'search' | 'directory'
  summary: string
  timestamp: number
}

export interface AgentSessionState {
  requestId: string
  assessment: TaskAssessment | null
  cumulativeTokens: number
  iterationCount: number
  exploredItems: Map<string, ExploredItem>
  summaries: ProgressSummary[]
  startTime: number
  lastActivity: number
}

/**
 * Budget configuration per task type
 */
export const TASK_BUDGETS: Record<TaskType, { tokens: number; iterations: number }> = {
  simple_query: { tokens: 10000, iterations: 3 },
  file_edit: { tokens: 30000, iterations: 8 },
  multi_file_refactor: { tokens: 60000, iterations: 15 },
  codebase_audit: { tokens: 80000, iterations: 20 },
  exploration: { tokens: 40000, iterations: 10 },
}

/**
 * Calculate token budget and iteration limit based on task assessment
 */
export function calculateBudget(
  taskType: TaskType,
  estimatedFiles: number
): { tokens: number; iterations: number } {
  const base = TASK_BUDGETS[taskType]
  
  // Adjust based on estimated files (cap at 2x multiplier)
  const fileMultiplier = Math.min(estimatedFiles / 10, 2.0)
  
  return {
    tokens: Math.floor(base.tokens * fileMultiplier),
    iterations: Math.floor(base.iterations * fileMultiplier),
  }
}

/**
 * Generate resource recommendation based on current usage
 */
export function getResourceRecommendation(stats: ResourceStats): string {
  const tokenPct = stats.percentage_used
  const iterationsRemaining = stats.iterations_remaining
  
  if (tokenPct >= 80 || iterationsRemaining <= 2) {
    return 'WARNING: Low on resources. Use agent.summarize_progress to compress context, then provide your findings to the user.'
  }
  
  if (tokenPct >= 50 || iterationsRemaining <= 5) {
    return 'CAUTION: Over halfway through your budget. Monitor usage carefully and avoid redundant operations.'
  }
  
  return 'Resources are healthy. Continue your investigation efficiently.'
}

/**
 * Format a progress summary for insertion into conversation
 */
export function formatSummary(summary: ProgressSummary): string {
  return `[Agent Progress Summary - ${new Date(summary.timestamp).toISOString()}]

Key Findings:
${summary.key_findings.map(f => `• ${f}`).join('\n')}

Files Already Examined:
${summary.files_examined.length > 0 ? summary.files_examined.map(f => `• ${f}`).join('\n') : '(none yet)'}

Next Steps:
${summary.next_steps.map(s => `• ${s}`).join('\n')}

[Previous tool outputs have been compressed to save tokens]
`
}

/**
 * Create initial session state
 */
export function createSessionState(requestId: string): AgentSessionState {
  return {
    requestId,
    assessment: null,
    cumulativeTokens: 0,
    iterationCount: 0,
    exploredItems: new Map(),
    summaries: [],
    startTime: Date.now(),
    lastActivity: Date.now(),
  }
}

