/**
 * Helper to infer badge content type from a tool name.
 * Exported separately so it can be unit-tested without pulling in React deps.
 */
export function inferContentType(toolName?: string): string {
  if (!toolName) return 'json'

  const normalized = toolName.toLowerCase()

  if (normalized.includes('edits.apply')) return 'diff'

  // MCP tools are user-extensible (e.g. mcp_playwright-...)
  // Treat them generically and route them to the operation-result viewer.
  if (normalized.startsWith('mcp_')) return 'operation-result'

  // FS tools
  // NOTE: fs tools now generally use server-provided contentType ('operation-result'),
  // but we keep inference for legacy tool names and to avoid regressions.
  if (normalized.includes('fs.read_lines')) return 'read-lines'
  if (normalized.startsWith('fs') || normalized.includes('fs.')) return 'operation-result'
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
  if (normalized.includes('operation-result') || normalized.includes('operationresult')) return 'operation-result'
  if (normalized === 'askforinput') return 'human-input'

  return 'json'
}
