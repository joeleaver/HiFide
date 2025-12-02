/**
 * Service Registry and Initialization
 * 
 * Central place to initialize and register all services.
 * Services replace Zustand slices with a simpler class-based architecture.
 */

import { ServiceRegistry } from './base/ServiceRegistry'
import { DebugService } from './DebugService'
import { ToolsService } from './ToolsService'
import { WorkspaceService } from './WorkspaceService'
import { ExplorerService } from './ExplorerService'
import { ProviderService } from './ProviderService'
import { SettingsService } from './SettingsService'
import { KanbanService } from './KanbanService'
import { KnowledgeBaseService } from './KnowledgeBaseService'
import { AppService } from './AppService'
import { TerminalService } from './TerminalService'
import { SessionService } from './SessionService'
import { FlowProfileService } from './FlowProfileService'
import { FlowConfigService } from './FlowConfigService'
import { FlowGraphService } from './FlowGraphService'
import { FlowCacheService } from './FlowCacheService'

// Singleton registry instance
const registry = ServiceRegistry.getInstance()

// Service instances (initialized lazily)
let debugService: DebugService | null = null
let toolsService: ToolsService | null = null
let workspaceService: WorkspaceService | null = null
let explorerService: ExplorerService | null = null
let providerService: ProviderService | null = null
let settingsService: SettingsService | null = null
let kanbanService: KanbanService | null = null
let knowledgeBaseService: KnowledgeBaseService | null = null
let appService: AppService | null = null
let terminalService: TerminalService | null = null
let sessionService: SessionService | null = null
let flowProfileService: FlowProfileService | null = null
let flowConfigService: FlowConfigService | null = null
let flowGraphService: FlowGraphService | null = null
let flowCacheService: FlowCacheService | null = null

/**
 * Initialize all services
 * Call this once during app startup
 */
export function initializeServices(): void {
  console.log('[Services] Initializing services...')

  // Phase 1: Simple services
  debugService = new DebugService()

  // Phase 2: Medium complexity
  toolsService = new ToolsService()
  workspaceService = new WorkspaceService()
  explorerService = new ExplorerService()
  providerService = new ProviderService()
  settingsService = new SettingsService()
  kanbanService = new KanbanService()
  knowledgeBaseService = new KnowledgeBaseService()

  // Phase 3: Session services (must come before terminal)
  sessionService = new SessionService()
  flowCacheService = new FlowCacheService()

  // Phase 4: Complex services that depend on session
  appService = new AppService()
  terminalService = new TerminalService()

  // Phase 5: Flow services
  flowProfileService = new FlowProfileService()
  flowConfigService = new FlowConfigService()
  flowGraphService = new FlowGraphService()

  // Register all services
  registry.register('debug', debugService)
  registry.register('tools', toolsService)
  registry.register('workspace', workspaceService)
  registry.register('explorer', explorerService)
  registry.register('provider', providerService)
  registry.register('settings', settingsService)
  registry.register('kanban', kanbanService)
  registry.register('knowledgeBase', knowledgeBaseService)
  registry.register('app', appService)
  registry.register('terminal', terminalService)
  registry.register('session', sessionService)
  registry.register('flowCache', flowCacheService)
  registry.register('flowProfile', flowProfileService)
  registry.register('flowConfig', flowConfigService)
  registry.register('flowGraph', flowGraphService)

  console.log('[Services] Initialized:', registry.getServiceNames().join(', '))
}

/**
 * Get the service registry
 */
export function getServiceRegistry(): ServiceRegistry {
  return registry
}

/**
 * Get a specific service by name
 */
export function getService<T>(name: string): T {
  return registry.get<T>(name)
}

/**
 * Convenience getters for all services
 */
export function getDebugService(): DebugService {
  if (!debugService) throw new Error('[Services] DebugService not initialized')
  return debugService
}

export function getToolsService(): ToolsService {
  if (!toolsService) throw new Error('[Services] ToolsService not initialized')
  return toolsService
}

export function getWorkspaceService(): WorkspaceService {
  if (!workspaceService) throw new Error('[Services] WorkspaceService not initialized')
  return workspaceService
}

export function getExplorerService(): ExplorerService {
  if (!explorerService) throw new Error('[Services] ExplorerService not initialized')
  return explorerService
}

export function getProviderService(): ProviderService {
  if (!providerService) throw new Error('[Services] ProviderService not initialized')
  return providerService
}

export function getSettingsService(): SettingsService {
  if (!settingsService) throw new Error('[Services] SettingsService not initialized')
  return settingsService
}

export function getKanbanService(): KanbanService {
  if (!kanbanService) throw new Error('[Services] KanbanService not initialized')
  return kanbanService
}

export function getKnowledgeBaseService(): KnowledgeBaseService {
  if (!knowledgeBaseService) throw new Error('[Services] KnowledgeBaseService not initialized')
  return knowledgeBaseService
}

export function getAppService(): AppService {
  if (!appService) throw new Error('[Services] AppService not initialized')
  return appService
}

export function getTerminalService(): TerminalService {
  if (!terminalService) throw new Error('[Services] TerminalService not initialized')
  return terminalService
}

export function getSessionService(): SessionService {
  if (!sessionService) throw new Error('[Services] SessionService not initialized')
  return sessionService
}

export function getFlowProfileService(): FlowProfileService {
  if (!flowProfileService) throw new Error('[Services] FlowProfileService not initialized')
  return flowProfileService
}

export function getFlowConfigService(): FlowConfigService {
  if (!flowConfigService) throw new Error('[Services] FlowConfigService not initialized')
  return flowConfigService
}

export function getFlowGraphService(): FlowGraphService {
  if (!flowGraphService) throw new Error('[Services] FlowGraphService not initialized')
  return flowGraphService
}

export function getFlowCacheService(): FlowCacheService {
  if (!flowCacheService) throw new Error('[Services] FlowCacheService not initialized')
  return flowCacheService
}

/**
 * Export service classes for type imports
 */
export { DebugService } from './DebugService'
export { ToolsService } from './ToolsService'
export { WorkspaceService } from './WorkspaceService'
export { ExplorerService } from './ExplorerService'
export { ProviderService } from './ProviderService'
export { SettingsService } from './SettingsService'
export { KanbanService } from './KanbanService'
export { KnowledgeBaseService } from './KnowledgeBaseService'
export { AppService } from './AppService'
export { TerminalService } from './TerminalService'
export { SessionService } from './SessionService'
export { FlowProfileService } from './FlowProfileService'
export { FlowConfigService } from './FlowConfigService'
export { FlowGraphService } from './FlowGraphService'
export { FlowCacheService } from './FlowCacheService'

