/**
 * BadgeProcessor - Centralized badge configuration and processing
 * 
 * Eliminates duplicate badge logic across multiple layers by providing
 * a single source of truth for badge behavior and styling.
 */

import { BadgeContentType, BadgeStatus, BadgeType } from '../store/types'

// ---------------------------------------------------------------------------
// Shared utilities (server-side) for consistent badge labels/metadata
// ---------------------------------------------------------------------------

const shortenMiddle = (value: string, max = 80) => {
  if (value.length <= max) return value
  const keep = Math.max(10, Math.floor((max - 3) / 2))
  return `${value.slice(0, keep)}...${value.slice(-keep)}`
}

const safeByteLength = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  try {
    return Buffer.byteLength(value, 'utf8')
  } catch {
    return undefined
  }
}

type FileEffectAction = 'read' | 'write' | 'append' | 'truncate' | 'delete' | 'move' | 'copy' | 'mkdir' | 'stat' | 'exists' | 'list'

type BadgeToolPayload = {
  kind: 'tool-payload'
  toolName?: string
  inputs?: unknown
  outputs?: unknown
  effects?: {
    files?: Array<{ action: FileEffectAction; path?: string; from?: string; to?: string; bytes?: number; lines?: { start?: number; end?: number; added?: number; removed?: number } }>
  }
  diagnostics?: {
    durationMs?: number
    ok?: boolean
    exitCode?: number
    timedOut?: boolean
    error?: string
  }
}

const buildToolPayload = (badge: any, partial?: Partial<BadgeToolPayload>): BadgeToolPayload => {
  const durationMs =
    typeof badge.metadata?.duration === 'number'
      ? badge.metadata.duration
      : typeof badge.startTimestamp === 'number' && typeof badge.endTimestamp === 'number'
        ? Math.max(0, badge.endTimestamp - badge.startTimestamp)
        : undefined

  return {
    kind: 'tool-payload',
    toolName: badge.toolName,
    inputs: badge.args,
    outputs: badge.result,
    diagnostics: {
      durationMs,
      ok: badge.result?.ok,
      exitCode: badge.result?.exitCode,
      timedOut: badge.result?.timedOut,
      error: badge.result?.error
    },
    ...partial,
    effects: {
      ...(partial?.effects ?? {}),
    }
  }
}

export interface BadgeConfig {
  // Basic properties
  toolName: string
  defaultType: BadgeType
  
  // Content configuration
  contentType?: BadgeContentType
  requiresExpansion?: boolean
  
  // Label and metadata handling
  generateLabel: (badge: any) => string
  // Short, tool-name-free summary shown next to the tool pill in the header
  // (e.g. for fsReadFile: "path/to/file.ts", for workspaceSearch: "\"query\" (23 results)")
  generateTitle?: (badge: any) => string
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

    // -----------------------------------------------------------------------
    // Generic MCP tool handling
    // MCP tool names are user-extensible; we intentionally avoid tool-specific
    // badge configs and instead apply consistent labeling + operation-result.
    // -----------------------------------------------------------------------

    const parseMcpToolName = (toolName: string) => {
      // Convention in this codebase: mcp_<serverId>_<toolName>
      // Examples:
      // - mcp_playwright-dbcb6f_browser_navigate
      // - mcp_rivalsearchmcp-b3cd8b_google_search
      const withoutPrefix = toolName.replace(/^mcp_/, '')
      const parts = withoutPrefix.split('_')
      if (parts.length < 2) {
        return { server: shortenMiddle(withoutPrefix, 40), tool: '' }
      }

      const server = parts[0]
      const tool = parts.slice(1).join('_')
      return { server: shortenMiddle(server, 40), tool: shortenMiddle(tool, 60) }
    }

    const pickMcpTitleParam = (args: any): { key?: string; value?: string } => {
      if (!args || typeof args !== 'object') return {}
      const preferredKeys = ['url', 'query', 'path', 'resource', 'topic', 'keyword', 'keywords', 'text', 'name', 'id', 'title']
      for (const key of preferredKeys) {
        const value = (args as any)[key]
        if (typeof value === 'string' && value.trim()) return { key, value: shortenMiddle(value.trim(), 80) }
        if (Array.isArray(value) && value.length) {
          const rendered = value.slice(0, 3).map(v => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ')
          return { key, value: shortenMiddle(rendered, 80) }
        }
      }
      return {}
    }

    const mcpGenericConfig: BadgeConfig = {
      toolName: 'mcp_*',
      defaultType: 'tool',
      contentType: 'operation-result',
      requiresExpansion: true,
      generateTitle: (badge: any) => {
        const toolName = badge.toolName || badge.name || 'mcp_unknown'
        const { server, tool } = parseMcpToolName(toolName)
        return tool ? `MCP ${server}: ${tool}` : `MCP ${server}`
      },
      generateLabel: (badge: any) => {
        // server/tool are already included in title; label focuses on a key arg
        const picked = pickMcpTitleParam(badge.args)
        const suffix = picked.key && picked.value ? `${picked.key}: ${picked.value}` : ''
        return suffix
      },
      enrichMetadata: (badge: any) => {
        const toolName = badge.toolName || badge.name || 'mcp_unknown'
        const { server, tool } = parseMcpToolName(toolName)
        const payload = buildToolPayload({ ...badge, toolName }, {})
        return {
          server,
          mcpTool: tool,
          fullParams: payload,
        }
      },
      determineStatus: (badge: any) => badge.result?.error ? 'error' : 'success',
      isExpandable: (_badge: any) => true,
      shouldShowPreview: (_badge: any) => false
    }

    // Register early: specific first-party tool configs still override this.
    this.register(mcpGenericConfig)
    
    // Terminal Exec
    const terminalExecConfig: BadgeConfig = {
      toolName: 'terminalExec',
      defaultType: 'tool',
      contentType: 'terminal-exec',
      requiresExpansion: true,
      generateTitle: (_badge: any) => 'Terminal',
      generateLabel: (badge: any) => {
        const command = badge.args?.command || badge.metadata?.command
        if (!command) return ''
        const cmdPreview = command.length > 40 ? `${command.substring(0, 40)}...` : command
        return `$ ${cmdPreview}`
      },
      enrichMetadata: (badge: any) => {
        const command = badge.args?.command
        const metadata: Record<string, any> = command ? { command } : {}

        // Standard expandable payload (v1)
        metadata.fullParams = buildToolPayload(badge)

        return metadata
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
      generateTitle: (_badge: any) => 'Workspace Search',
      generateLabel: (badge: any) => {
        const query = badge.args?.query || badge.metadata?.query
        return query ? `"${query}"` : ''
      },
      enrichMetadata: (badge: any) => {
        const metadata: Record<string, any> = {}
        const query = badge.args?.query
        if (query) metadata.query = query

        // Standard expandable payload (v1)
        metadata.fullParams = buildToolPayload(badge)

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
      contentType: 'search',
      requiresExpansion: true,
      // Title should show key parameter (pattern)
      generateTitle: (badge: any) => {
        const pattern = badge.args?.pattern || badge.metadata?.pattern
        return pattern ? `Grep: "${pattern}"` : 'Grep'
      },
      generateLabel: (_badge: any) => '',
      enrichMetadata: (badge: any) => {
        const pattern = badge.args?.pattern
        const md: Record<string, any> = {}
        if (pattern) md.pattern = pattern
        md.fullParams = buildToolPayload(badge)
        return md
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
      generateLabel: (_badge: any) => '',
      // Title should primarily show the file name (applyEdits is the tool pill)
      generateTitle: (badge: any) => {
        const fileCount = badge.result?.previewCount || 1
        if (fileCount === 1) {
          // Try to get filename from files array or result
          const files = badge.result?.files || []
          const firstFile = files[0]?.path || badge.result?.files?.[0] || 'Unknown File'
          const fileName = firstFile.split(/[/\\]/).pop()
          return fileName ? String(fileName) : 'Apply Edits'
        }
        return fileCount ? `(${fileCount} files)` : 'Apply Edits'
      },
      enrichMetadata: (badge: any) => ({
        fileCount: badge.result?.previewCount,
        addedLines: badge.result?.addedLines,
        removedLines: badge.result?.removedLines,
        fullParams: buildToolPayload(badge)
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
    // Most file tools should be expandable so the user can inspect inputs/outputs.
    // NOTE: we keep contentType as 'json' for now because there is no dedicated
    // OperationResultViewer wired in BadgeContent yet.
    const fsToolNames = [
      'fsReadFile',
      'fsReadLines',
      'fsReadDir',
      'fsExists',
      'fsStat',
      'fsWriteFile',
      'fsAppendFile',
      'fsTruncateFile',
      'fsCreateDir',
      'fsMove',
      'fsCopy',
      'fsDeleteFile',
      'fsDeleteDir',
      'fsRemove',
      'fsTruncateDir',
      // legacy / alternate names
      'fs.read_file',
      'fs.write_file',
      'fs.delete_file',
      'fs.create_dir'
    ]

    const fsOpLabel = (badge: any) => {
      // Tool name should live ONLY in the tool pill (BadgeHeader). Keep label concise.
      const path = badge.args?.path || badge.metadata?.path
      const from = badge.args?.from
      const to = badge.args?.to

      if (typeof from === 'string' && typeof to === 'string') {
        return `${shortenMiddle(from, 90)} → ${shortenMiddle(to, 90)}`
      }
      if (typeof path === 'string') {
        return `${shortenMiddle(path, 110)}`
      }
      return ''
    }

    fsToolNames.forEach((toolName) => {
      this.register({
        toolName,
        defaultType: 'tool',
        contentType: 'operation-result',
        requiresExpansion: true,
        generateLabel: (badge: any) => fsOpLabel(badge),
        enrichMetadata: (badge: any) => {
          const md: Record<string, any> = {}
          if (badge.args?.path) md.path = badge.args.path
          if (badge.args?.from) md.from = badge.args.from
          if (badge.args?.to) md.to = badge.args.to

          // Standard expansion payload (inputs/effects/outputs/diagnostics)
          const action: Record<string, FileEffectAction> = {
            fsReadFile: 'read',
            'fs.read_file': 'read',
            fsReadLines: 'read',
            'fs.read_lines': 'read',
            fsReadDir: 'list',
            fsExists: 'exists',
            fsStat: 'stat',
            fsWriteFile: 'write',
            'fs.write_file': 'write',
            fsAppendFile: 'append',
            fsTruncateFile: 'truncate',
            fsCreateDir: 'mkdir',
            'fs.create_dir': 'mkdir',
            fsMove: 'move',
            fsCopy: 'copy',
            fsDeleteFile: 'delete',
            'fs.delete_file': 'delete',
            fsDeleteDir: 'delete',
            fsRemove: 'delete',
            fsTruncateDir: 'truncate',
          }

          const bytes = safeByteLength(badge.args?.content)

          const fileEffect = {
            action: action[toolName] ?? 'read',
            path: badge.args?.path,
            from: badge.args?.from,
            to: badge.args?.to,
            bytes,
            lines: toolName === 'fsReadLines'
              ? {
                start: badge.args?.startLine,
                end: badge.args?.endLine,
              }
              : undefined
          }

          md.fullParams = buildToolPayload(badge, {
            effects: {
              files: [fileEffect]
            }
          })

          // Header summary values
          if (toolName === 'fsReadLines') {
            const rc = typeof badge.result?.resultCount === 'number'
              ? badge.result.resultCount
              : typeof badge.result?.count === 'number'
                ? badge.result.count
                : undefined
            if (typeof rc === 'number') md.resultCount = rc
          }
          if (toolName === 'fsReadDir' && Array.isArray(badge.result?.entries)) {
            md.entryCount = badge.result.entries.length
          }
          if (typeof bytes === 'number' && (toolName === 'fsWriteFile' || toolName === 'fsAppendFile')) {
            md.bytes = bytes
          }

          return md
        },
        determineStatus: (badge: any) => {
          if (badge.result?.error) return 'error'
          // Some fs tools return ok:false with error string
          if (badge.result?.ok === false) return 'error'
          return 'success'
        },
        isExpandable: (_badge: any) => true,
        shouldShowPreview: (_badge: any) => false
      })
    })

    // Kanban Tools
    this.register({
      toolName: 'kanbanGetBoard',
      defaultType: 'tool',
      contentType: 'operation-result',
      requiresExpansion: true,
      generateTitle: (_badge: any) => 'Kanban Board',
      generateLabel: (badge: any) => {
        const status = badge.args?.status
        const epicId = badge.args?.epicId
        const parts: string[] = []
        if (status) parts.push(`(${status})`)
        if (epicId) parts.push(`[Epic: ${epicId}]`)
        return parts.join(' ')
      },
      enrichMetadata: (badge: any) => {
        const md: Record<string, any> = {
          status: badge.args?.status,
          epicId: badge.args?.epicId,
        }
        md.fullParams = buildToolPayload(badge)
        if (badge.result && typeof badge.result === 'object') {
          const count = typeof badge.result?.resultCount === 'number'
            ? badge.result.resultCount
            : typeof badge.result?.count === 'number'
              ? badge.result.count
              : undefined
          if (typeof count === 'number') md.resultCount = count
        }
        return md
      },
      determineStatus: (badge: any) => badge.result?.error ? 'error' : 'success',
      isExpandable: (_badge: any) => true,
      shouldShowPreview: (_badge: any) => false
    })

    this.register({
      toolName: 'kanbanCreateTask',
      defaultType: 'tool',
      contentType: 'operation-result',
      requiresExpansion: true,
      generateLabel: (badge: any) => {
        const title = badge.args?.title
        return title ? `"${title}"` : ''
      },
      // Title should be the task title
      generateTitle: (badge: any) => {
        const title = badge.args?.title
        return title ? String(title) : 'Create Task'
      },
      enrichMetadata: (badge: any) => {
        const taskId = badge.result?.task?.id ?? badge.result?.id
        return {
          title: badge.args?.title,
          status: badge.args?.status,
          epicId: badge.args?.epicId,
          taskId,
          fullParams: buildToolPayload(badge),
        }
      },
      determineStatus: (badge: any) => badge.result?.error ? 'error' : 'success',
      isExpandable: (_badge: any) => true,
      shouldShowPreview: (_badge: any) => false
    })

    this.register({
      toolName: 'kanbanUpdateTask',
      defaultType: 'tool',
      contentType: 'operation-result',
      requiresExpansion: true,
      generateLabel: (badge: any) => {
        const taskId = badge.args?.taskId
        const title = badge.args?.title
        if (!taskId) return ''
        const parts: string[] = [String(taskId)]
        if (title) parts.push(`("${title}")`)
        return parts.join(' ')
      },
      generateTitle: (_badge: any) => 'Update Task',
      enrichMetadata: (badge: any) => ({
        ...badge.args,
        fullParams: buildToolPayload(badge),
        taskId: badge.args?.taskId ?? badge.result?.task?.id ?? badge.result?.id
      }),
      determineStatus: (badge: any) => badge.result?.error ? 'error' : 'success',
      isExpandable: (_badge: any) => true,
      shouldShowPreview: (_badge: any) => false
    })

    this.register({
      toolName: 'kanbanDeleteTask',
      defaultType: 'tool',
      contentType: 'operation-result',
      requiresExpansion: true,
      generateTitle: (_badge: any) => 'Delete Task',
      generateLabel: (badge: any) => {
        const taskId = badge.args?.taskId
        return taskId ? String(taskId) : ''
      },
      enrichMetadata: (badge: any) => ({
        taskId: badge.args?.taskId,
        fullParams: buildToolPayload(badge)
      }),
      determineStatus: (badge: any) => badge.result?.error ? 'error' : 'success',
      isExpandable: (_badge: any) => true,
      shouldShowPreview: (_badge: any) => false
    })

    this.register({
      toolName: 'kanbanMoveTask',
      defaultType: 'tool',
      contentType: 'operation-result',
      requiresExpansion: true,
      generateTitle: (_badge: any) => 'Move Task',
      generateLabel: (badge: any) => {
        const taskId = badge.args?.taskId
        const toStatus = badge.args?.status
        // Best-effort: allow server-side tool result to carry previous status
        const fromStatus = badge.result?.fromStatus ?? badge.result?.from?.status ?? badge.result?.task?.status

        const parts: string[] = []
        if (taskId) parts.push(String(taskId))
        if (fromStatus && toStatus) parts.push(`${fromStatus} → ${toStatus}`)
        else if (toStatus) parts.push(`→ ${toStatus}`)
        return parts.join(' ')
      },
      enrichMetadata: (badge: any) => ({
        taskId: badge.args?.taskId,
        fromStatus: badge.result?.fromStatus ?? badge.result?.from?.status ?? badge.result?.task?.status,
        toStatus: badge.args?.status,
        index: badge.args?.index,
        fullParams: buildToolPayload(badge)
      }),
      determineStatus: (badge: any) => badge.result?.error ? 'error' : 'success',
      isExpandable: (_badge: any) => true,
      shouldShowPreview: (_badge: any) => false
    })

    this.register({
      toolName: 'kanbanCreateEpic',
      defaultType: 'tool',
      contentType: 'operation-result',
      requiresExpansion: true,
      generateLabel: (badge: any) => {
        const name = badge.args?.name
        return name ? `"${name}"` : ''
      },
      generateTitle: (_badge: any) => 'Create Epic',
      enrichMetadata: (badge: any) => ({
        name: badge.args?.name,
        epicId: badge.result?.epic?.id ?? badge.result?.id,
        fullParams: buildToolPayload(badge)
      }),
      determineStatus: (badge: any) => badge.result?.error ? 'error' : 'success',
      isExpandable: (_badge: any) => true,
      shouldShowPreview: (_badge: any) => false
    })

    this.register({
      toolName: 'kanbanUpdateEpic',
      defaultType: 'tool',
      contentType: 'operation-result',
      requiresExpansion: true,
      generateLabel: (badge: any) => {
        const epicId = badge.args?.epicId
        const name = badge.args?.name
        if (!epicId) return ''
        const parts: string[] = [String(epicId)]
        if (name) parts.push(`("${name}")`)
        return parts.join(' ')
      },
      generateTitle: (_badge: any) => 'Update Epic',
      enrichMetadata: (badge: any) => ({
        epicId: badge.args?.epicId,
        name: badge.args?.name,
        fullParams: buildToolPayload(badge)
      }),
      determineStatus: (badge: any) => badge.result?.error ? 'error' : 'success',
      isExpandable: (_badge: any) => true,
      shouldShowPreview: (_badge: any) => false
    })

    this.register({
      toolName: 'kanbanDeleteEpic',
      defaultType: 'tool',
      contentType: 'operation-result',
      requiresExpansion: true,
      generateTitle: (_badge: any) => 'Delete Epic',
      generateLabel: (badge: any) => {
        const epicId = badge.args?.epicId
        return epicId ? String(epicId) : ''
      },
      enrichMetadata: (badge: any) => ({
        epicId: badge.args?.epicId,
        fullParams: buildToolPayload(badge)
      }),
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
      // Avoid redundant "KB Search" text; show the query/tags in the title.
      generateTitle: (badge: any) => {
        const query = badge.args?.query
        const tags = badge.args?.tags
        if (query) return `"${query}"`
        if (Array.isArray(tags) && tags.length) return `[${tags.join(', ')}]`
        return 'Search'
      },
      generateLabel: (badge: any) => {
        const query = badge.args?.query
        const tags = badge.args?.tags
        const limit = badge.args?.limit
        const parts: string[] = []
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
        metadata.fullParams = buildToolPayload(badge)
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

        // knowledgeBaseSearch tool often returns { count, results } but tests use
        // an older wrapper shape: { data: { results: [...] } }
        const results = badge.result?.results ?? badge.result?.data?.results
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
      contentType: 'operation-result',
      requiresExpansion: true,
      generateLabel: (badge: any) => {
        const title = badge.args?.title
        const id = badge.args?.id
        if (id && !title) return `Update ${id}`
        return title ? `"${title}"` : ''
      },
      generateTitle: (_badge: any) => 'KB Store',
      enrichMetadata: (badge: any) => {
        const args = badge.args ?? {}
        const payload = buildToolPayload(badge)
        return {
          title: args.title,
          id: args.id,
          tags: args.tags,
          fullParams: payload,
        }
      },
      determineStatus: (badge: any) => badge.result?.error ? 'error' : 'success',
      isExpandable: (_badge: any) => true,
      shouldShowPreview: (_badge: any) => false
    })

    this.register({
      toolName: 'knowledgeBaseDelete',
      defaultType: 'tool',
      contentType: 'operation-result',
      requiresExpansion: true,
      generateLabel: (badge: any) => {
        const id = badge.args?.id
        return id ? String(id) : ''
      },
      generateTitle: (_badge: any) => 'KB Delete',
      enrichMetadata: (badge: any) => {
        const args = badge.args ?? {}
        const payload = buildToolPayload(badge)
        return {
          id: args.id,
          fullParams: payload,
        }
      },
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
      generateTitle: (badge: any) => {
        const toolName = badge.toolName || badge.name || 'Unknown Tool'
        return toolName
      },
      generateLabel: (_badge: any) => '',
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

    // MCP wildcard match (user-extensible tools)
    if (!config && typeof toolName === 'string' && toolName.startsWith('mcp_')) {
      const mcpWildcard = this.configs.get('mcp_*')
      if (mcpWildcard) config = mcpWildcard
    }
    
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

      // Header title generation (avoid repeating the tool name)
      title: config.generateTitle ? config.generateTitle(badge) : undefined,
      
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