/**
 * Tools Slice
 *
 * Central mapping of agent tool names to UI categories for grouping in the Tools node.
 * This lives in the main-process store to be the single source of truth.
 *
 * Categories:
 * - agent:       Agent self-regulation (assess/check/summarize)
 * - fs:          Filesystem operations
 * - edits:       Code editing (apply edits/patches/targeted)
 * - workspace:   Workspace discovery and Knowledge Base
 * - index:       Search/index utilities (includes textGrep)
 * - terminal:    Terminal/session tools
 * - code:        Code analysis/refactors (AST search, small transforms)
 * - other:       Fallback for uncategorized tools
 */

import type { StateCreator } from 'zustand'

export type ToolCategory =
  | 'agent'
  | 'fs'
  | 'edits'
  | 'workspace'
  | 'index'
  | 'terminal'
  | 'code'
  | 'other'

export interface ToolsSlice {
  toolCategoryMap: Record<string, ToolCategory>
  getToolCategory: (name: string) => ToolCategory
}

const DEFAULT_TOOL_CATEGORY_MAP: Record<string, ToolCategory> = {
  // Agent
  agentAssessTask: 'agent',
  agentCheckResources: 'agent',
  agentSummarizeProgress: 'agent',

  // Filesystem
  fsReadFile: 'fs',
  fsReadLines: 'fs',
  fsReadDir: 'fs',
  fsWriteFile: 'fs',
  fsCreateDir: 'fs',
  fsDeleteDir: 'fs',
  fsDeleteFile: 'fs',
  fsExists: 'fs',
  fsStat: 'fs',
  fsAppendFile: 'fs',
  kanbanGetBoard: 'workspace',
  kanbanCreateTask: 'workspace',
  kanbanUpdateTask: 'workspace',
  kanbanDeleteTask: 'workspace',
  kanbanMoveTask: 'workspace',
  kanbanCreateEpic: 'workspace',
  kanbanUpdateEpic: 'workspace',
  kanbanDeleteEpic: 'workspace',

  // Terminal
  codeApplyEditsTargeted: 'edits',

  // Workspace + Knowledge Base
  workspaceSearch: 'workspace',
  workspaceJump: 'workspace',
  workspaceMap: 'workspace',
  knowledgeBaseSearch: 'workspace',
  knowledgeBaseStore: 'workspace',

  // Terminal
  terminalExec: 'terminal',
  sessionTail: 'terminal',
  sessionSearchOutput: 'terminal',
  sessionRestart: 'terminal',

  // Code analysis
  searchAst: 'code',
  replaceCall: 'code',
  replaceConsoleLevel: 'code',

  // Search/index
  indexSearch: 'index',
  textGrep: 'index',
}

export const createToolsSlice: StateCreator<ToolsSlice, [], [], ToolsSlice> = (_set, _get) => ({
  toolCategoryMap: DEFAULT_TOOL_CATEGORY_MAP,

  getToolCategory: (name: string): ToolCategory => {
    // Direct mapping first
    const direct = DEFAULT_TOOL_CATEGORY_MAP[name as keyof typeof DEFAULT_TOOL_CATEGORY_MAP]
    if (direct) return direct

    // Heuristics as fallback to keep future tools grouped reasonably
    if (name.startsWith('fs')) return 'fs'
    if (name.startsWith('agent')) return 'agent'
    if (name.startsWith('workspace') || name.startsWith('knowledgeBase')) return 'workspace'
    if (name.toLowerCase().includes('applyedits') || name.toLowerCase().includes('patch')) return 'edits'
    if (name.startsWith('terminal') || name.startsWith('session')) return 'terminal'
    if (name.toLowerCase().includes('search') || name.toLowerCase().includes('grep')) return 'index'
    if (name.toLowerCase().includes('ast') || name.startsWith('replace')) return 'code'

    return 'other'
  },
})

