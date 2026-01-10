import { EmbeddingService } from './vector/EmbeddingService.js';
import { VectorService } from './vector/VectorService.js';
import { KBIndexerService } from './vector/KBIndexerService.js';
import { MemoriesIndexerService } from './vector/MemoriesIndexerService.js';
import { ToolsIndexerService } from './vector/ToolsIndexerService.js';
import { GlobalIndexingOrchestrator } from './indexing/GlobalIndexingOrchestrator.js';
import { WorkspaceService } from './WorkspaceService.js';
import { ToolsService } from './ToolsService.js';
import { AppService } from './AppService.js';
import { SettingsService } from './SettingsService.js';
import { ProviderService } from './ProviderService.js';
import { SessionService } from './SessionService.js';
import { KanbanService } from './KanbanService.js';
import { KnowledgeBaseService } from './KnowledgeBaseService.js';
import { McpService } from './McpService.js';
import { ExplorerService } from './ExplorerService.js';
import { LanguageServerService } from './LanguageServerService.js';
import { GitStatusService } from './GitStatusService.js';
import { GitDiffService } from './GitDiffService.js';
import { GitLogService } from './GitLogService.js';
import { GitCommitService } from './GitCommitService.js';
import { FlowGraphService } from './FlowGraphService.js';
import { FlowContextsService } from './FlowContextsService.js';
import { FlowProfileService } from './FlowProfileService.js';
import { FlowCacheService } from './FlowCacheService.js';
import { WorkspaceSearchService } from './WorkspaceSearchService.js';

let embeddingService: EmbeddingService;
let vectorService: VectorService;
let kbIndexerService: KBIndexerService;
let memoriesIndexerService: MemoriesIndexerService;
let toolsIndexerService: ToolsIndexerService;
let globalIndexingOrchestratorService: GlobalIndexingOrchestrator;
let workspaceService: WorkspaceService;
let toolsService: ToolsService;
let appService: AppService;
let settingsService: SettingsService;
let providerService: ProviderService;
let sessionService: SessionService;
let kanbanService: KanbanService;
let knowledgeBaseService: KnowledgeBaseService;
let mcpService: McpService;
let explorerService: ExplorerService;
let languageServerService: LanguageServerService;
let gitStatusService: GitStatusService;
let gitDiffService: GitDiffService;
let gitLogService: GitLogService;
let gitCommitService: GitCommitService;
let flowGraphService: FlowGraphService;
let flowContextsService: FlowContextsService;
let flowProfileService: FlowProfileService;
let flowCacheService: FlowCacheService;
let workspaceSearchService: WorkspaceSearchService;

import { ServiceRegistry } from './base/ServiceRegistry.js';

export function initializeServices() {
  const registry = ServiceRegistry.getInstance();

  settingsService = new SettingsService();
  registry.register('settings', settingsService);

  providerService = new ProviderService();
  registry.register('provider', providerService);

  appService = new AppService();
  registry.register('app', appService);
  
  embeddingService = new EmbeddingService();
  registry.register('embedding', embeddingService);

  vectorService = new VectorService();
  registry.register('vector', vectorService);

  workspaceService = new WorkspaceService();
  registry.register('workspace', workspaceService);

  kbIndexerService = new KBIndexerService();
  registry.register('kbIndexer', kbIndexerService);

  memoriesIndexerService = new MemoriesIndexerService();
  registry.register('memoriesIndexer', memoriesIndexerService);

  globalIndexingOrchestratorService = new GlobalIndexingOrchestrator();
  registry.register('globalIndexingOrchestrator', globalIndexingOrchestratorService);

  toolsService = new ToolsService();
  registry.register('tools', toolsService);
  
  sessionService = new SessionService();
  registry.register('session', sessionService);

  kanbanService = new KanbanService();
  registry.register('kanban', kanbanService);

  knowledgeBaseService = new KnowledgeBaseService();
  registry.register('knowledgeBase', knowledgeBaseService);

  mcpService = new McpService();
  registry.register('mcp', mcpService);

  toolsIndexerService = new ToolsIndexerService();
  registry.register('toolsIndexer', toolsIndexerService);
  // Attach MCP listener after MCP service is registered
  toolsIndexerService.attachMcpListener();

  explorerService = new ExplorerService();
  registry.register('explorer', explorerService);

  languageServerService = new LanguageServerService();
  registry.register('languageServer', languageServerService);

  gitStatusService = new GitStatusService();
  registry.register('gitStatus', gitStatusService);

  gitDiffService = new GitDiffService();
  registry.register('gitDiff', gitDiffService);

  gitLogService = new GitLogService();
  registry.register('gitLog', gitLogService);

  gitCommitService = new GitCommitService();
  registry.register('gitCommit', gitCommitService);
  
  flowGraphService = new FlowGraphService();
  registry.register('flowGraph', flowGraphService);

  flowContextsService = new FlowContextsService();
  registry.register('flowContexts', flowContextsService);

  flowProfileService = new FlowProfileService();
  registry.register('flowProfile', flowProfileService);

  flowCacheService = new FlowCacheService();
  registry.register('flowCache', flowCacheService);

  workspaceSearchService = new WorkspaceSearchService();
  registry.register('workspaceSearch', workspaceSearchService);
}

export const getEmbeddingService = () => embeddingService;
export const getVectorService = () => vectorService;
export const getKBIndexerService = () => kbIndexerService;
export const getMemoriesIndexerService = () => memoriesIndexerService;
export const getToolsIndexerService = () => toolsIndexerService;
export const getGlobalIndexingOrchestratorService = () => globalIndexingOrchestratorService;
export const getWorkspaceService = () => workspaceService;
export const getToolsService = () => toolsService;
export const getAppService = () => appService;
export const getSettingsService = () => settingsService;
export const getProviderService = () => providerService;
export const getSessionService = () => sessionService;
export const getKanbanService = () => kanbanService;
export const getKnowledgeBaseService = () => knowledgeBaseService;
export const getMcpService = () => mcpService;
export const getExplorerService = () => explorerService;
export const getLanguageServerService = () => languageServerService;
export const getGitStatusService = () => gitStatusService;
export const getGitDiffService = () => gitDiffService;
export const getGitLogService = () => gitLogService;
export const getGitCommitService = () => gitCommitService;
export const getFlowGraphService = () => flowGraphService;
export const getFlowContextsService = () => flowContextsService;
export const getFlowProfileService = () => flowProfileService;
export const getFlowCacheService = () => flowCacheService;
export const getWorkspaceSearchService = () => workspaceSearchService;
