/**
 * Helper to infer badge content type from a tool name.
 * Exported separately so it can be unit-tested without pulling in React deps.
 */
export function inferContentType(toolName?: string): string {
  if (!toolName) return 'json'

  const normalized = toolName.toLowerCase()

  if (normalized.includes('edits.apply')) return 'diff'
  if (normalized.includes('fs.read_lines')) return 'read-lines'
  if (
    normalized.includes('workspace.search') ||
    normalized.includes('workspacesearch') ||
    normalized.includes('searchworkspace')
  ) {
    return 'workspace-search'
  }
  if (
    normalized.includes('knowledgebase.search') ||
    normalized.includes('knowledgebasesearch')
  ) {
    return 'kb-search'
  }
  if (normalized.includes('knowledgebase.store')) return 'kb-store'
  if (normalized.includes('index.search')) return 'search'
  if (normalized === 'terminalexec' || normalized === 'terminal.exec') return 'terminal-exec'

  return 'json'
}
