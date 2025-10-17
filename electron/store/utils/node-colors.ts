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
  intentRouter: '#f39c12',
  redactor: '#14b8a6',
  budgetGuard: '#f59e0b',
  errorDetection: '#f97316',
  approvalGate: '#ef4444',
  parallelSplit: '#8b5cf6',
  parallelJoin: '#10b981',
  portalInput: '#ec4899',
  portalOutput: '#ec4899',
}

/**
 * Human-readable labels for node kinds
 */
export const NODE_KIND_LABELS: Record<string, string> = {
  defaultContextStart: 'Context Start',
  userInput: 'User Input',
  manualInput: 'Manual Input',
  newContext: 'New Context',
  llmRequest: 'LLM Request',
  tools: 'Tools',
  intentRouter: 'Intent Router',
  parallelSplit: 'Split',
  parallelJoin: 'Merge',
  redactor: 'Redactor',
  budgetGuard: 'Budget Guard',
  errorDetection: 'Error Detection',
  approvalGate: 'Approval Gate',
  portalInput: 'Portal In',
  portalOutput: 'Portal Out',
}

/**
 * Get color for a node kind with fallback
 */
export function getNodeColor(kind: string | undefined): string {
  if (!kind) return '#4a4a4a'
  return NODE_COLORS[kind] || '#4a4a4a'
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
  intentRouter: 'flow-control',
  parallelSplit: 'flow-control',
  parallelJoin: 'flow-control',
  portalInput: 'flow-control',
  portalOutput: 'flow-control',
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
 * Get category for a node kind
 */
export function getNodeCategory(kind: string | undefined): NodeCategory | undefined {
  if (!kind) return undefined
  return NODE_CATEGORIES[kind]
}

/**
 * Get human-readable label for a node kind
 */
export function getNodeKindLabel(kind: string | undefined): string {
  if (!kind) return 'Unknown'
  return NODE_KIND_LABELS[kind] || kind
}

/**
 * Format a node title for display in chat/session
 * Format: "NODE TYPE: Node Title"
 * Example: "LLM REQUEST: My Custom Node"
 */
export function formatNodeTitle(nodeKind: string | undefined, nodeLabel: string | undefined): string {
  const kindLabel = getNodeKindLabel(nodeKind)
  const title = nodeLabel || kindLabel

  // If the title is the same as the kind label, just return the uppercase kind label
  if (title === kindLabel) {
    return kindLabel.toUpperCase()
  }

  // Otherwise, format as "KIND: Title"
  return `${kindLabel.toUpperCase()}: ${title}`
}

