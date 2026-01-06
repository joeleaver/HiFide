/**
 * Agent Tools Registry
 *
 * Aggregates all agent tools from individual files.
 */


import type { AgentTool } from '../providers/provider.js'

// Agent self-regulation tools
import { assessTaskTool } from './agent/assessTask.js'
import { checkResourcesTool } from './agent/checkResources.js'
import { summarizeProgressTool } from './agent/summarizeProgress.js'

// Filesystem tools
import { readFileTool } from './fs/readFile.js'
import { readLinesTool } from './fs/readLines.js'
import { readDirTool } from './fs/readDir.js'
import { writeFileTool } from './fs/writeFile.js'
import { createDirTool } from './fs/createDir.js'
import { deleteDirTool } from './fs/deleteDir.js'
import { deleteFileTool } from './fs/deleteFile.js'
import { existsTool } from './fs/exists.js'
import { statTool } from './fs/stat.js'
import { appendFileTool } from './fs/appendFile.js'
import { moveTool } from './fs/move.js'
import { copyTool } from './fs/copy.js'
import { removeTool } from './fs/remove.js'
import { truncateFileTool } from './fs/truncateFile.js'
import { truncateDirTool } from './fs/truncateDir.js'

// Edit tools
import { applyEditsTool } from './edits/apply.js'

// Kanban tools
import { kanbanGetBoardTool } from './kanban/getBoard.js'
import { kanbanCreateTaskTool } from './kanban/createTask.js'
import { kanbanUpdateTaskTool } from './kanban/updateTask.js'
import { kanbanLogWorkOnTaskTool } from './kanban/logWorkOnTask.js'
import { kanbanGetTaskTool } from './kanban/getTask.js'
import { kanbanDeleteTaskTool } from './kanban/deleteTask.js'
import { kanbanMoveTaskTool } from './kanban/moveTask.js'
import { kanbanCreateEpicTool } from './kanban/createEpic.js'
import { kanbanUpdateEpicTool } from './kanban/updateEpic.js'
import { kanbanDeleteEpicTool } from './kanban/deleteEpic.js'

// Workspace tools
import { searchWorkspaceTool } from './workspace/searchWorkspace.js'
import { workspaceMapTool } from './workspace/map.js'

// Terminal tools
import { terminalExecTool } from './terminal/exec.js'

// Text tools
import { grepTool } from './text/grep.js'

// Knowledge base tools
import { knowledgeBaseSearchTool } from './kb/search.js'
import { knowledgeBaseStoreTool } from './kb/store.js'
import { knowledgeBaseDeleteTool } from './kb/delete.js'
import { knowledgeBaseGetTool } from './kb/get.js'

// Human Interaction tools
import { askForInputTool } from './human/askForInput.js'


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

  askForInputTool,
]
