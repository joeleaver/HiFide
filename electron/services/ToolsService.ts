/**
 * Tools Service
 * 
 * Central mapping of agent tool names to UI categories for grouping in the Tools node.
 */

import { Service } from './base/Service.js'

export type ToolCategory =
  | 'agent'
  | 'fs'
  | 'edits'
  | 'workspace'
  | 'project'
  | 'index'
  | 'terminal'
  | 'code'
  | 'mcp'
  | 'other'

interface ToolsState {
  toolCategoryMap: Record<string, ToolCategory>
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

  // Project Management (Kanban)
  kanbanGetBoard: 'project',
  kanbanCreateTask: 'project',
  kanbanUpdateTask: 'project',
  kanbanDeleteTask: 'project',
  kanbanMoveTask: 'project',
  kanbanCreateEpic: 'project',
  kanbanUpdateEpic: 'project',
  kanbanDeleteEpic: 'project',

  // Edits

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
  terminalSessionCommandOutput: 'terminal',
  sessionRestart: 'terminal',

  // Code analysis
  searchAst: 'code',
  replaceCall: 'code',
  replaceConsoleLevel: 'code',

  // Search/index
  indexSearch: 'index',
  textGrep: 'index',
}

export class ToolsService extends Service<ToolsState> {
  constructor() {
    super({
      toolCategoryMap: DEFAULT_TOOL_CATEGORY_MAP,
    })
  }

  protected onStateChange(): void {
    // No persistence or notifications needed for tools
  }

  getToolCategory(name: string): ToolCategory {
    // Direct mapping first
    const direct = this.state.toolCategoryMap[name]
    if (direct) return direct

    // Heuristics as fallback
    if (name.startsWith('fs')) return 'fs'
    if (name.startsWith('kanban')) return 'project'
    if (name.startsWith('terminal') || name.startsWith('session')) return 'terminal'
    if (name.startsWith('workspace') || name.startsWith('knowledgeBase')) return 'workspace'
    if (name.startsWith('agent')) return 'agent'
    if (name.startsWith('mcp')) return 'mcp'
    if (name.startsWith('code') || name.startsWith('search') || name.startsWith('replace')) return 'code'
    if (name.startsWith('index') || name.startsWith('text')) return 'index'

    return 'other'
  }

  getToolCategoryMap(): Record<string, ToolCategory> {
    return { ...this.state.toolCategoryMap }
  }
}

