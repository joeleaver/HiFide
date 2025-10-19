/**
 * Centralized node color configuration
 * Single source of truth for all node colors across the application
 */

export const NODE_COLORS: Record<string, string> = {
  defaultContextStart: '#3b82f6',
  userInput: '#4a9eff',
  manualInput: '#06b6d4',
  newContext: '#9b59b6',
  llmRequest: '#1e3a8a',      // Dark blue - easy on the eyes for the most common node
  tools: '#f97316',
  injectMessages: '#06b6d4',  // Cyan - message injection/context manipulation
  intentRouter: '#f39c12',
  redactor: '#14b8a6',
  budgetGuard: '#f59e0b',
  errorDetection: '#f97316',
  approvalGate: '#ef4444',
  parallelSplit: '#8b5cf6',
  parallelJoin: '#10b981',
  portalInput: '#ec4899',
  portalOutput: '#ec4899',
  cache: '#1e88e5',           // Blue - caching/performance optimization
}

/**
 * Human-readable labels for node types
 */
export const NODE_TYPE_LABELS: Record<string, string> = {
  defaultContextStart: 'Context Start',
  userInput: 'User Input',
  manualInput: 'Manual Input',
  newContext: 'New Context',
  llmRequest: 'LLM Request',
  tools: 'Tools',
  injectMessages: 'Inject Messages',
  intentRouter: 'Intent Router',
  parallelSplit: 'Split',
  parallelJoin: 'Merge',
  redactor: 'Redactor',
  budgetGuard: 'Budget Guard',
  errorDetection: 'Error Detection',
  approvalGate: 'Approval Gate',
  portalInput: 'Portal In',
  portalOutput: 'Portal Out',
  cache: 'Cache',
}

/**
 * Get color for a node type with fallback
 */
export function getNodeColor(nodeType: string | undefined): string {
  if (!nodeType) return '#4a4a4a'
  return NODE_COLORS[nodeType] || '#4a4a4a'
}

/**
 * Node categories for palette organization
 */
export type NodeCategory = 'input' | 'llm' | 'flow-control' | 'safety'

export const NODE_CATEGORIES: Record<string, NodeCategory> = {
  userInput: 'input',
  manualInput: 'input',
  llmRequest: 'llm',
  tools: 'llm',
  newContext: 'llm',
  injectMessages: 'llm',
  intentRouter: 'flow-control',
  parallelSplit: 'flow-control',
  parallelJoin: 'flow-control',
  portalInput: 'flow-control',
  portalOutput: 'flow-control',
  cache: 'flow-control',
  redactor: 'safety',
  budgetGuard: 'safety',
  errorDetection: 'safety',
  approvalGate: 'safety',
}

export const CATEGORY_LABELS: Record<NodeCategory, string> = {
  'input': 'Input',
  'llm': 'LLM',
  'flow-control': 'Flow Control',
  'safety': 'Safety',
}

/**
 * Get category for a node type
 */
export function getNodeCategory(nodeType: string | undefined): NodeCategory | undefined {
  if (!nodeType) return undefined
  return NODE_CATEGORIES[nodeType]
}

/**
 * Get human-readable label for a node type
 */
export function getNodeTypeLabel(nodeType: string | undefined): string {
  if (!nodeType) return 'Unknown'
  return NODE_TYPE_LABELS[nodeType] || nodeType
}

/**
 * Format a node title for display in chat/session
 * Format: "NODE TYPE: Node Title"
 * Example: "LLM REQUEST: My Custom Node"
 */
export function formatNodeTitle(nodeType: string | undefined, nodeLabel: string | undefined): string {
  const typeLabel = getNodeTypeLabel(nodeType)
  const title = nodeLabel || typeLabel

  // If the title is the same as the type label, just return the uppercase type label
  if (title === typeLabel) {
    return typeLabel.toUpperCase()
  }

  // Otherwise, format as "TYPE: Title"
  return `${typeLabel.toUpperCase()}: ${title}`
}

