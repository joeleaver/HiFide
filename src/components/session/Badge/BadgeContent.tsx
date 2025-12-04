/**
 * BadgeContent - Smart dispatcher for badge content
 * Routes to appropriate content viewer based on badge type
 */

import { useUiStore } from '../../../store/ui'
import type { Badge as BadgeType } from '../../../../electron/store/types'
import { DiffViewer } from './viewers/DiffViewer'
import { CodeViewer } from './viewers/CodeViewer'
import { SearchResultsViewer } from './viewers/SearchResultsViewer'
import { WorkspaceSearchViewer } from './viewers/WorkspaceSearchViewer'
import { WorkspaceMapViewer } from './viewers/WorkspaceMapViewer'
import { KBSearchViewer } from './viewers/KBSearchViewer'
import { KBStoreViewer } from './viewers/KBStoreViewer'
import { AgentAssessViewer } from './viewers/AgentAssessViewer'
import { UsageBreakdownViewer } from './viewers/UsageBreakdownViewer'
import { JsonViewer } from './viewers/JsonViewer'
import { ErrorViewer } from './viewers/ErrorViewer'

interface BadgeContentProps {
  badge: BadgeType
}

export function BadgeContent({ badge }: BadgeContentProps) {
  const isExpanded = useUiStore((s) => s.expandedBadges?.has(badge.id) ?? (badge.defaultExpanded ?? false))

  // Don't render if not expanded
  if (!isExpanded) return null

  // Error badges
  if (badge.type === 'error') {
    return <ErrorViewer badge={badge} />
  }

  // Route based on contentType or toolName
  const contentType = badge.contentType || inferContentType(badge.toolName)

  switch (contentType) {
    case 'diff':
      return <DiffViewer badge={badge} />
    
    case 'read-lines':
      return <CodeViewer badge={badge} />
    
    case 'search':
    case 'ast-search':
      return <SearchResultsViewer badge={badge} />
    
    case 'workspace-search':
    case 'workspace-jump':
      return <WorkspaceSearchViewer badge={badge} />
    
    case 'workspace-map':
      return <WorkspaceMapViewer badge={badge} />
    
    case 'kb-search':
      return <KBSearchViewer badge={badge} />
    
    case 'kb-store':
      return <KBStoreViewer badge={badge} />

    case 'agent-assess':
      return <AgentAssessViewer badge={badge} />

    case 'usage-breakdown':
      return <UsageBreakdownViewer badge={badge} />
    
    case 'json':
    case 'text':
    default:
      return <JsonViewer badge={badge} />
  }
}

/**
 * Infer content type from tool name
 */
function inferContentType(toolName?: string): string {
  if (!toolName) return 'json'

  // Map tool names to content types
  if (toolName.includes('edits.apply')) return 'diff'
  if (toolName.includes('fs.read_lines')) return 'read-lines'
  if (toolName.includes('workspace.search')) return 'workspace-search'
  if (toolName.includes('knowledgeBase.search')) return 'kb-search'
  if (toolName.includes('knowledgeBase.store')) return 'kb-store'
  if (toolName.includes('index.search')) return 'search'

  return 'json'
}

