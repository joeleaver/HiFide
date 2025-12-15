/**
 * BadgeProcessor - Centralized badge configuration and processing
 * 
 * Eliminates duplicate badge logic across multiple layers by providing
 * a single source of truth for badge behavior and styling.
 */

import { BadgeContentType, BadgeStatus, BadgeType } from '../store/types'

export interface BadgeConfig {
  // Basic properties
  toolName: string
  defaultType: BadgeType
  
  // Content configuration
  contentType?: BadgeContentType
  requiresExpansion?: boolean
  
  // Label and metadata handling
  generateLabel: (badge: any) => string
  enrichMetadata: (badge: any) => Record<string, any>
  enrichInteractive?: (badge: any) => { type: string; data: any } | undefined
  
  // Status determination
  determineStatus: (badge: any) => BadgeStatus
  
  // Expansion rules
  isExpandable: (badge: any) => boolean
  shouldShowPreview: (badge: any) => boolean
}

/**
 * Centralized badge registry
 * Single source of truth for all badge behavior
 */
class BadgeConfigRegistry {
  private configs = new Map<string, BadgeConfig>()
  
  constructor() {
    this.initializeDefaults()
  }
  
  private initializeDefaults() {
    
    // Terminal Exec
    const terminalExecConfig: BadgeConfig = {
      toolName: 'terminalExec',
      defaultType: 'tool',
      contentType: 'terminal-exec',
      requiresExpansion: true,
      generateLabel: (badge: any) => {
        const command = badge.args?.command || badge.metadata?.command
        if (!command) return 'Terminal Command'
        const cmdPreview = command.length > 40 ? `${command.substring(0, 40)}...` : command
        return `$ ${cmdPreview}`
      },
      enrichMetadata: (badge: any) => {
        const command = badge.args?.command
        return command ? { command } : {}
      },
      determineStatus: (badge: any) => {
        if (badge.result?.error) return 'error'
        if (badge.result?.exitCode !== 0) return 'warning'
        return 'success'
      },
      isExpandable: (_badge: any) => true,
      shouldShowPreview: (badge: any) => Boolean(badge.result?.output || badge.result?.error)
    }
    this.register(terminalExecConfig)
    this.register({ ...terminalExecConfig, toolName: 'terminal.exec' })
    
    // Workspace Search
    const workspaceSearchConfig: BadgeConfig = {
      toolName: 'workspaceSearch',
      defaultType: 'tool',
      contentType: 'workspace-search',
      requiresExpansion: true,
      generateLabel: (badge: any) => {
        const query = badge.args?.query || badge.metadata?.query
        return query ? `Search: ${query}` : 'Workspace Search'
      },
      enrichMetadata: (badge: any) => {
        const metadata: Record<string, any> = {}
        const query = badge.args?.query
        if (query) metadata.query = query

        if (badge.args) {
          metadata.fullParams = { ...badge.args }
        }

        const count = typeof badge.result?.count === 'number'
          ? badge.result.count
          : typeof badge.result?.resultCount === 'number'
            ? badge.result.resultCount
            : undefined

        if (typeof count === 'number') {
          metadata.resultCount = count
        }

        return metadata
      },
      determineStatus: (badge: any) => {
        if (badge.result?.error) return 'error'
        if (badge.result?.results?.length === 0) return 'warning'
        return 'success'
      },
      isExpandable: (badge: any) => Boolean(badge.result?.results?.length > 0 || badge.result?.error),
      shouldShowPreview: (badge: any) => Boolean(badge.result?.results || badge.result?.error)
    }
    this.register(workspaceSearchConfig)
    this.register({ ...workspaceSearchConfig, toolName: 'workspace.search' })
    this.register({ ...workspaceSearchConfig, toolName: 'searchWorkspace' })
    
    // Text Grep
    this.register({
      toolName: 'textGrep',
      defaultType: 'tool',
      contentType: 'text-search',
      requiresExpansion: true,
      generateLabel: (badge: any) => {
        const pattern = badge.args?.pattern || badge.metadata?.pattern
        return pattern ? `Grep: ${pattern}` : 'Text Grep'
      },
      enrichMetadata: (badge: any) => {
        const pattern = badge.args?.pattern
        return pattern ? { pattern } : {}
      },
      determineStatus: (badge: any) => {
        if (badge.result?.error) return 'error'
        if (badge.result?.matches?.length === 0) return 'warning'
        return 'success'
      },
      isExpandable: (badge: any) => Boolean(badge.result?.matches?.length > 0 || badge.result?.error),
      shouldShowPreview: (badge: any) => Boolean(badge.result?.matches || badge.result?.error)
    })
    
    // Apply Edits (Diff Viewer)
    this.register({
      toolName: 'applyEdits',
      defaultType: 'tool',
      contentType: 'diff',
      requiresExpansion: true,
      generateLabel: (badge: any) => {
        const fileCount = badge.result?.previewCount || 1
        if (fileCount === 1) {
          // Try to get filename from files array or result
          const files = badge.result?.files || []
          const firstFile = files[0]?.path || badge.result?.files?.[0] || 'Unknown File'
          const fileName = firstFile.split(/[/\\]/).pop()
          return `Apply Edits: ${fileName}`
        }
        return `Apply Edits (${fileCount} files)`
      },
      enrichMetadata: (badge: any) => ({
        fileCount: badge.result?.previewCount,
        addedLines: badge.result?.addedLines,
        removedLines: badge.result?.removedLines
      }),
      enrichInteractive: (badge: any) => {
        // If result contains previewKey, use it for RPC fetch
        if (badge.result?.previewKey) {
          return {
            type: 'diff',
            data: { key: badge.result.previewKey }
          }
        }
        // If result contains files array directly
        if (Array.isArray(badge.result?.files)) {
          return {
            type: 'diff',
            data: badge.result.files
          }
        }
        return undefined
      },
      determineStatus: (badge: any) => badge.result?.error ? 'error' : 'success',
      isExpandable: (_badge: any) => true,
      shouldShowPreview: (_badge: any) => false // Diff viewer handles its own preview state
    })

    // FS Operations
    const fsToolNames = ['fsWriteFile', 'fsReadFile', 'fsDeleteFile', 'fsCreateDir', 'fsDeleteDir', 'fs.read_file', 'fs.write_file', 'fs.delete_file', 'fs.create_dir']
    fsToolNames.forEach(toolName => {
      this.register({
        toolName,
        defaultType: 'tool',
        contentType: 'operation-result',
        requiresExpansion: false,
        generateLabel: (badge: any) => {
          const path = badge.args?.path || badge.metadata?.path
          const sanitizedPath = path && path.length > 30 ? `...${path.slice(-30)}` : path
          return `${toolName}: ${sanitizedPath || 'No path'}`
        },
        enrichMetadata: (badge: any) => {
          const path = badge.args?.path
          return path ? { path } : {}
        },
        determineStatus: (badge: any) => {
          if (badge.result?.error) return 'error'
          return 'success'
        },
        isExpandable: (badge: any) => Boolean(badge.result?.error),
        shouldShowPreview: (_badge: any) => false
      })
    })

    // Kanban Tools
    this.register({
      toolName: 'kanbanGetBoard',
      defaultType: 'tool',
      contentType: 'json',
      requiresExpansion: true,
      generateLabel: (badge: any) => {
        const status = badge.args?.status
        const epicId = badge.args?.epicId
        const parts = ['Kanban Board']
        if (status) parts.push(`(${status})`)
        if (epicId) parts.push(`[Epic: ${epicId}]`)
        return parts.join(' ')
      },
      enrichMetadata: (badge: any) => ({
        status: badge.args?.status,
        epicId: badge.args?.epicId
      }),
      determineStatus: (badge: any) => badge.result?.error ? 'error' : 'success',
      isExpandable: (_badge: any) => true,
      shouldShowPreview: (_badge: any) => false
    })

    this.register({
      toolName: 'kanbanCreateTask',
      defaultType: 'tool',
      contentType: 'json',
      requiresExpansion: true,
      generateLabel: (badge: any) => {
        const title = badge.args?.title
        return title ? `Create Task: "${title}"` : 'Create Task'
      },
      enrichMetadata: (badge: any) => ({
        title: badge.args?.title,
        status: badge.args?.status,
        epicId: badge.args?.epicId
      }),
      determineStatus: (badge: any) => badge.result?.error ? 'error' : 'success',
      isExpandable: (_badge: any) => true,
      shouldShowPreview: (_badge: any) => false
    })

    this.register({
      toolName: 'kanbanUpdateTask',
      defaultType: 'tool',
      contentType: 'json',
      requiresExpansion: true,
      generateLabel: (badge: any) => {
        const taskId = badge.args?.taskId
        const title = badge.args?.title
        return taskId ? `Update Task: ${taskId}` + (title ? ` ("${title}")` : '') : 'Update Task'
      },
      enrichMetadata: (badge: any) => ({ ...badge.args }),
      determineStatus: (badge: any) => badge.result?.error ? 'error' : 'success',
      isExpandable: (_badge: any) => true,
      shouldShowPreview: (_badge: any) => false
    })

    // Knowledge Base Tools
    const kbSearchConfig: BadgeConfig = {
      toolName: 'knowledgeBaseSearch',
      defaultType: 'tool',
      contentType: 'kb-search',
      requiresExpansion: true,
      generateLabel: (badge: any) => {
        const query = badge.args?.query
        const tags = badge.args?.tags
        const limit = badge.args?.limit
        const parts = ['KB Search']
        if (query) parts.push(`"${query}"`)
        if (Array.isArray(tags) && tags.length) parts.push(`[${tags.join(', ')}]`)
        if (typeof limit === 'number') parts.push(`(limit ${limit})`)
        return parts.join(' ')
      },
      enrichMetadata: (badge: any) => {
        const metadata: Record<string, any> = {
          query: badge.args?.query,
          tags: badge.args?.tags,
        }
        if (typeof badge.args?.limit === 'number') {
          metadata.limit = badge.args.limit
        }
        if (badge.args) {
          metadata.fullParams = { ...badge.args }
        }
        const count = typeof badge.result?.count === 'number'
          ? badge.result.count
          : typeof badge.result?.resultCount === 'number'
            ? badge.result.resultCount
            : undefined
        if (typeof count === 'number') {
          metadata.resultCount = count
        }
        return metadata
      },
      determineStatus: (badge: any) => {
        if (badge.result?.error) return 'error'
        const results = badge.result?.results
        if (Array.isArray(results) && results.length === 0) return 'warning'
        return 'success'
      },
      isExpandable: (_badge: any) => true,
      shouldShowPreview: (_badge: any) => true
    }
    this.register(kbSearchConfig)
    this.register({ ...kbSearchConfig, toolName: 'knowledgeBase.search' })

    this.register({
      toolName: 'knowledgeBaseStore',
      defaultType: 'tool',
      contentType: 'json',
      requiresExpansion: true,
      generateLabel: (badge: any) => {
        const title = badge.args?.title
        const id = badge.args?.id
        if (id && !title) return `KB Store: Update ${id}`
        return title ? `KB Store: "${title}"` : 'KB Store'
      },
      enrichMetadata: (badge: any) => ({
        title: badge.args?.title,
        id: badge.args?.id,
        tags: badge.args?.tags
      }),
      determineStatus: (badge: any) => badge.result?.error ? 'error' : 'success',
      isExpandable: (_badge: any) => true,
      shouldShowPreview: (_badge: any) => false
    })

    // Default fallback for unknown tools
    this.register({
      toolName: '*',
      defaultType: 'tool',
      contentType: 'json',
      requiresExpansion: false,
      generateLabel: (badge: any) => {
        const toolName = badge.toolName || badge.name || 'Unknown Tool'
        return toolName
      },
      enrichMetadata: (_badge: any) => ({}),
      determineStatus: (badge: any) => {
        if (badge.result?.error) return 'error'
        return 'success'
      },
      isExpandable: (badge: any) => Boolean(badge.result?.error),
        shouldShowPreview: (_badge: any) => false
    })
    
  }
  
  register(config: BadgeConfig) {
    this.configs.set(config.toolName, config)
  }
  
  getConfig(toolName: string): BadgeConfig {
    // Try exact match first
    let config = this.configs.get(toolName)
    
    // Fall back to wildcard for unknown tools
    if (!config) {
      config = this.configs.get('*')!
    }
    
    return config
  }
  
  getAllConfigs(): BadgeConfig[] {
    return Array.from(this.configs.values())
  }
  
  // Validation helpers
  validateConfig(config: BadgeConfig): boolean {
    try {
      // Test that all required methods exist and work
      config.generateLabel({})
      config.enrichMetadata({})
      config.determineStatus({})
      config.isExpandable({})
      config.shouldShowPreview({})
      return true
    } catch {
      return false
    }
  }
  
  exportConfigs(): Record<string, BadgeConfig> {
    const result: Record<string, BadgeConfig> = {}
    this.configs.forEach((config, toolName) => {
      result[toolName] = { ...config }
    })
    return result
  }
}

export class BadgeProcessor {
  private registry: BadgeConfigRegistry
  
  constructor() {
    this.registry = new BadgeConfigRegistry()
  }
  
  /**
   * Process a badge from tool call result
   * This replaces the old enrichBadgeWithToolData function
   */
  processBadge(badge: any): any {
    const toolName = badge.toolName || badge.name
    if (!badge || !toolName) {
      return badge
    }
    
    const config = this.registry.getConfig(toolName)
    
    const enrichedMetadata = config.enrichMetadata(badge)

    // Apply configuration transformations
    const processedBadge = {
      ...badge,
      
      // Type and identification
      type: config.defaultType,
      toolName: toolName,
      
      // Content configuration
      contentType: config.contentType || 'json',
      
      // Label generation
      label: config.generateLabel(badge),
      
      // Metadata enrichment
      metadata: {
        ...badge.metadata,
        ...enrichedMetadata
      },

      // Promote specific metadata keys to top-level properties (needed for UI pills)
      addedLines: enrichedMetadata.addedLines ?? badge.addedLines,
      removedLines: enrichedMetadata.removedLines ?? badge.removedLines,
      filesChanged: enrichedMetadata.filesChanged ?? badge.filesChanged,

      // Interactive data enrichment
      interactive: config.enrichInteractive ? config.enrichInteractive(badge) : badge.interactive,
      
      // Status determination
      status: config.determineStatus(badge),
      
      // Expansion configuration
      expandable: config.isExpandable(badge),
      needsExpansion: config.requiresExpansion && config.isExpandable(badge),
      showPreview: config.shouldShowPreview(badge)
    }
    
    return processedBadge
  }
  
  /**
   * Check if a tool has a registered configuration
   */
  hasConfig(toolName: string): boolean {
    const config = this.registry.getConfig(toolName)
    return config.toolName !== '*'
  }
  
  /**
   * Register a new tool configuration
   */
  registerTool(config: BadgeConfig) {
    this.registry.register(config)
  }
  
  /**
   * Get all registered configurations (for debugging)
   */
  getAllConfigs(): BadgeConfig[] {
    return this.registry.getAllConfigs()
  }
  
  /**
   * Validate all configurations (for testing)
   */
  validateConfigs(): boolean {
    return this.registry.getAllConfigs().every(config => 
      this.registry.validateConfig(config)
    )
  }
}

// Singleton instance for the application
export const badgeProcessor = new BadgeProcessor()