/**
 * Agent Tools Registry
 * 
 * Aggregates all agent tools from individual files.
 * Each tool is self-contained in its own file for better maintainability.
 */

import type { AgentTool } from '../providers/provider'

// Agent tools
import { assessTaskTool } from './agent/assessTask'
import { checkResourcesTool } from './agent/checkResources'
import { summarizeProgressTool } from './agent/summarizeProgress'

// Filesystem tools
import { readFileTool } from './fs/readFile'
import { readDirTool } from './fs/readDir'
import { writeFileTool } from './fs/writeFile'
import { createDirTool } from './fs/createDir'
import { deleteDirTool } from './fs/deleteDir'
import { deleteFileTool } from './fs/deleteFile'
import { existsTool } from './fs/exists'
import { statTool } from './fs/stat'
import { appendFileTool } from './fs/appendFile'
import { moveTool } from './fs/move'
import { copyTool } from './fs/copy'
import { removeTool } from './fs/remove'
import { truncateFileTool } from './fs/truncateFile'
import { truncateDirTool } from './fs/truncateDir'

// Edits tools
import { applyEditsTool } from './edits/apply'

// Index tools
import { indexSearchTool } from './index/search'

// Terminal tools
import { terminalExecTool } from './terminal/exec'
import { sessionSearchOutputTool } from './terminal/sessionSearchOutput'
import { sessionTailTool } from './terminal/sessionTail'
import { sessionRestartTool } from './terminal/sessionRestart'

// Code tools
import { searchAstTool } from './code/searchAst'
import { applyEditsTargetedTool } from './code/applyEditsTargeted'

/**
 * Complete registry of all agent tools
 */
export const agentTools: AgentTool[] = [
  // Self-regulation tools
  assessTaskTool,
  checkResourcesTool,
  summarizeProgressTool,

  // File system tools
  readFileTool,
  readDirTool,
  writeFileTool,
  createDirTool,
  deleteDirTool,
  deleteFileTool,
  existsTool,
  statTool,
  appendFileTool,
  moveTool,
  copyTool,
  removeTool,
  truncateFileTool,
  truncateDirTool,

  // Edits tools
  applyEditsTool,

  // Index tools
  indexSearchTool,

  // Terminal tools
  terminalExecTool,
  sessionSearchOutputTool,
  sessionTailTool,
  sessionRestartTool,

  // Code tools
  searchAstTool,
  applyEditsTargetedTool,
]

