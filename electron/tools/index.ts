/**
 * Agent Tools Registry
 *
 * Aggregates all agent tools from individual files.
 */


import type { AgentTool } from '../providers/provider'

// Agent self-regulation tools
import { assessTaskTool } from './agent/assessTask'
import { checkResourcesTool } from './agent/checkResources'
import { summarizeProgressTool } from './agent/summarizeProgress'

// Filesystem tools
import { readFileTool } from './fs/readFile'
import { readLinesTool } from './fs/readLines'
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

// Edit tools
import { applyEditsTool } from './edits/apply'

// Kanban tools
import { kanbanGetBoardTool } from './kanban/getBoard'
import { kanbanCreateTaskTool } from './kanban/createTask'
import { kanbanUpdateTaskTool } from './kanban/updateTask'
import { kanbanLogWorkOnTaskTool } from './kanban/logWorkOnTask'
import { kanbanGetTaskTool } from './kanban/getTask'
import { kanbanDeleteTaskTool } from './kanban/deleteTask'
import { kanbanMoveTaskTool } from './kanban/moveTask'
import { kanbanCreateEpicTool } from './kanban/createEpic'
import { kanbanUpdateEpicTool } from './kanban/updateEpic'
import { kanbanDeleteEpicTool } from './kanban/deleteEpic'

// Workspace tools
import { searchWorkspaceTool } from './workspace/searchWorkspace'
import { workspaceMapTool } from './workspace/map'

// Terminal tools
import { terminalExecTool } from './terminal/exec'

// Text tools
import { grepTool } from './text/grep'

// Knowledge base tools
import { knowledgeBaseSearchTool } from './kb/search'
import { knowledgeBaseStoreTool } from './kb/store'
import { knowledgeBaseDeleteTool } from './kb/delete'
import { knowledgeBaseGetTool } from './kb/get'


export const agentTools: AgentTool[] = [
  assessTaskTool,
  checkResourcesTool,
  summarizeProgressTool,

  readFileTool,
  readLinesTool,
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

  applyEditsTool,

  kanbanGetBoardTool,
  kanbanCreateTaskTool,
  kanbanUpdateTaskTool,
  kanbanLogWorkOnTaskTool,
  kanbanGetTaskTool,
  kanbanDeleteTaskTool,
  kanbanMoveTaskTool,
  kanbanCreateEpicTool,
  kanbanUpdateEpicTool,
  kanbanDeleteEpicTool,

  searchWorkspaceTool,
  workspaceMapTool,

  terminalExecTool,

  grepTool,

  knowledgeBaseSearchTool,
  knowledgeBaseStoreTool,
  knowledgeBaseDeleteTool,
  knowledgeBaseGetTool,
]
