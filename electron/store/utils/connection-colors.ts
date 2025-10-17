/**
 * Centralized connection/handle color configuration
 * Single source of truth for all connection colors across the application
 */

export const CONNECTION_COLORS = {
  // Connection types
  context: '#9b59b6',  // Purple - for context/conversation flow
  data: '#2ecc71',     // Green - for data/result flow
  tools: '#f97316',    // Orange - for tools connections
  
  // Special states
  default: '#666',     // Gray - fallback for unknown connections
  selected: '#007acc', // Blue - for selected edges
} as const

/**
 * Get color for a connection type with fallback
 */
export function getConnectionColor(type: 'context' | 'data' | 'tools' | 'default' | 'selected'): string {
  return CONNECTION_COLORS[type] || CONNECTION_COLORS.default
}

/**
 * Determine connection color based on handle names
 * This implements the logic for auto-detecting connection type from handles
 */
export function getConnectionColorFromHandles(
  sourceHandle?: string,
  targetHandle?: string
): string {
  // Context connections (purple)
  if (sourceHandle === 'context' || targetHandle === 'context' || targetHandle === 'input') {
    return CONNECTION_COLORS.context
  }
  
  // Tools connections (orange)
  if (targetHandle === 'tools') {
    return CONNECTION_COLORS.tools
  }
  
  // Data/result connections (green)
  if (sourceHandle === 'result' || sourceHandle === 'data' || 
      sourceHandle?.includes('-data') || targetHandle?.includes('data')) {
    return CONNECTION_COLORS.data
  }
  
  // Default fallback
  return CONNECTION_COLORS.default
}

