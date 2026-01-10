/**
 * semanticTools node
 *
 * Provides semantic tool discovery via 2 meta-tools:
 * - searchTools: Semantic search over tool descriptions
 * - executeTool: Execute any tool by name
 *
 * This dramatically reduces token overhead from 5,000-10,000 tokens
 * (40+ full tool schemas) to ~200 tokens (2 meta-tools).
 *
 * The LLM can iteratively search for tools as needs evolve during execution,
 * then execute them by name with the correct parameters.
 *
 * Usage:
 * Connect the output of a Tools node to this node's tools input.
 * The Tools node handles tool selection/filtering (including MCP plugins).
 * This node provides semantic search over those selected tools.
 *
 * Inputs:
 * - context: Execution context (pass-through)
 * - tools: Array of tools from upstream Tools node (required)
 *
 * Outputs:
 * - context: Pass-through context
 * - tools: Array containing 2 meta-tools (searchTools, executeTool)
 *
 * Config:
 * - searchLimit: Max tools returned per search (default: 5)
 * - similarityThreshold: Min similarity score (default: 0.3)
 */

import type { NodeFunction, NodeExecutionPolicy } from '../types'
import type { AgentTool } from '../../providers/provider'
import { getEmbeddingService } from '../../services/index.js'
import { getToolByName as getToolByNameFromRegistry } from '../../tools/agentToolRegistry.js'

const DEFAULT_SEARCH_LIMIT = 5
const DEFAULT_SIMILARITY_THRESHOLD = 0.3
const SUGGESTION_COUNT = 3

/**
 * Node metadata
 */
export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy,
  description: 'Provides semantic tool discovery with searchTools and executeTool meta-tools. Reduces token overhead by ~85%.'
}

/**
 * Default system instructions for semantic tool discovery.
 * Teaches the LLM how to use the search-then-execute pattern.
 */
export const DEFAULT_SYSTEM_INSTRUCTIONS = `## Tool Discovery Protocol

You have access to a semantic tool discovery system with two meta-tools:

### searchTools(query)
Search for tools by describing a SINGLE capability you need.

**Critical:** Search for ONE thing at a time. Each search returns only the best match(es).
- GOOD: "read file" → finds fsReadFile
- GOOD: "create task" → finds kanbanCreateTask
- BAD: "read file, write file, create task" → only returns ONE tool, wastes the others!

### executeTool(toolName, parameters)
Execute a discovered tool by its exact name.

**Workflow:**
1. Need a capability? Search for it
2. **Execute immediately** - do NOT search for other tools first
3. After execution completes, then search for the next capability you need
4. Repeat: search one → execute → search next → execute

**Anti-pattern to avoid:**
- BAD: search "write file" → search "read file" → search "edit file" → now execute
- GOOD: search "write file" → execute write → search "read file" → execute read

**Tool Memory:**
Once you discover a tool name, remember it! You don't need to search again for tools you've already found in this conversation. Just call executeTool directly with the remembered name.

**Important:**
- Execute immediately after each search - don't pre-gather tools
- Remember tool names you've discovered - reuse them without re-searching
- Tool names are case-sensitive and must match exactly`

/**
 * Build searchable text from a tool definition
 */
function buildToolSearchText(tool: AgentTool): string {
  const parts: string[] = []
  parts.push(`Tool: ${tool.name}`)
  if (tool.description) {
    parts.push(`Description: ${tool.description}`)
  }
  if (tool.parameters?.properties) {
    const props = tool.parameters.properties
    const paramParts = Object.entries(props).map(([name, schema]: [string, any]) => {
      const desc = schema.description || ''
      const type = schema.type || 'any'
      return `  - ${name} (${type}): ${desc}`
    })
    if (paramParts.length) {
      parts.push('Parameters:')
      parts.push(...paramParts)
    }
  }
  return parts.join('\n')
}

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Tool with cached embedding
 */
interface EmbeddedTool {
  tool: AgentTool
  searchText: string
  embedding: number[] | null
}

/**
 * Semantic search context - holds tools and their embeddings
 */
class SemanticSearchContext {
  private tools: Map<string, EmbeddedTool> = new Map()
  private embeddingService = getEmbeddingService()

  constructor(inputTools: AgentTool[]) {
    for (const tool of inputTools) {
      this.tools.set(tool.name, {
        tool,
        searchText: buildToolSearchText(tool),
        embedding: null // Lazy embed
      })
    }
  }

  getToolByName(name: string): AgentTool | undefined {
    return this.tools.get(name)?.tool
  }

  getAllTools(): AgentTool[] {
    return Array.from(this.tools.values()).map(t => t.tool)
  }

  get toolCount(): number {
    return this.tools.size
  }

  /**
   * Search for tools by semantic similarity
   */
  async search(query: string, limit: number, threshold: number): Promise<Array<{
    name: string
    description: string
    parameters: any
    score: number
  }>> {
    if (this.tools.size === 0) {
      return []
    }

    // Embed the query
    const queryEmbedding = await this.embeddingService.embed(query)

    // Compute similarity with each tool
    const results: Array<{ tool: AgentTool; score: number }> = []

    for (const [, embeddedTool] of this.tools) {
      // Lazy embed tool description
      if (!embeddedTool.embedding) {
        embeddedTool.embedding = await this.embeddingService.embed(embeddedTool.searchText)
      }

      const score = cosineSimilarity(queryEmbedding, embeddedTool.embedding)
      if (score >= threshold) {
        results.push({ tool: embeddedTool.tool, score })
      }
    }

    // Sort by score descending and take top N
    results.sort((a, b) => b.score - a.score)
    const topResults = results.slice(0, limit)

    return topResults.map(r => ({
      name: r.tool.name,
      description: r.tool.description || '',
      parameters: r.tool.parameters || {},
      score: r.score
    }))
  }

  /**
   * Get suggestions for an invalid tool name
   */
  async getSuggestions(toolName: string, limit: number): Promise<Array<{
    name: string
    description: string
  }>> {
    // Use lower threshold for suggestions
    const results = await this.search(toolName, limit, 0.1)
    return results.map(r => ({
      name: r.name,
      description: r.description
    }))
  }
}

/**
 * Build the searchTools meta-tool
 */
function buildSearchToolsTool(
  searchContext: SemanticSearchContext,
  config: Record<string, any>
): AgentTool {
  const limit = config.searchLimit || DEFAULT_SEARCH_LIMIT
  const threshold = config.similarityThreshold || DEFAULT_SIMILARITY_THRESHOLD

  return {
    name: 'searchTools',
    description: `REQUIRED: query parameter. Example: searchTools({query: "read file"})

Searches for tools by capability. Returns matching tool(s) with their parameter schemas.

Search for ONE capability at a time - multi-capability queries only return ONE result.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'REQUIRED. The capability you need, e.g. "read file", "create task", "search code"'
        },
        limit: {
          type: 'number',
          description: `Max results (default: ${limit})`
        }
      },
      required: ['query']
    },
    run: async (input: { query: string; limit?: number }) => {
      // Validate required parameter - some models (e.g., via OpenRouter) may omit it
      if (!input.query || typeof input.query !== 'string' || !input.query.trim()) {
        return {
          found: 0,
          error: 'Missing required parameter: query. You must provide a search query describing the capability you need.',
          example: 'searchTools({query: "read file"}) or searchTools({query: "create task"})',
          tools: []
        }
      }

      const results = await searchContext.search(
        input.query,
        input.limit || limit,
        threshold
      )

      if (results.length === 0) {
        return {
          found: 0,
          message: 'No matching tools found. Try rephrasing your query or being more specific.',
          tools: []
        }
      }

      return {
        found: results.length,
        tools: results.map(r => ({
          name: r.name,
          description: r.description,
          parameters: r.parameters,
          relevance: Math.round(r.score * 100) + '%'
        }))
      }
    }
  }
}

/**
 * Build the executeTool meta-tool
 */
function buildExecuteToolTool(
  searchContext: SemanticSearchContext,
  requestId: string,
  workspaceId: string,
  flowAPI: any
): AgentTool {
  return {
    name: 'executeTool',
    description: `REQUIRED: toolName and parameters. Example: executeTool({toolName: "fsReadFile", parameters: {path: "file.txt"}})

Runs a tool discovered via searchTools. Use the exact tool name from search results.`,
    parameters: {
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          description: 'REQUIRED. Exact tool name from searchTools (e.g. "fsReadFile", "kanbanCreateTask")'
        },
        parameters: {
          type: 'object',
          description: 'REQUIRED. Parameters matching the tool\'s schema from searchTools'
        }
      },
      required: ['toolName', 'parameters']
    },
    run: async (input: { toolName: string; parameters: any }) => {
      // Validate required parameter - some models may omit it
      if (!input.toolName || typeof input.toolName !== 'string' || !input.toolName.trim()) {
        return {
          success: false,
          error: 'Missing required parameter: toolName. You must provide the exact tool name from searchTools results.',
          example: 'executeTool({toolName: "fsReadFile", parameters: {path: "README.md"}})',
          hint: 'First use searchTools to discover tool names, then pass the exact name here.'
        }
      }

      // Guard against trying to execute the meta-tools themselves
      if (input.toolName === 'searchTools' || input.toolName === 'executeTool') {
        return {
          success: false,
          error: `Cannot execute '${input.toolName}' - this is a meta-tool, not a discoverable tool. Use searchTools to find available tools, then pass those tool names to executeTool.`,
          hint: 'Example: searchTools({query: "read file"}) returns tools like "fsReadFile", then use executeTool({toolName: "fsReadFile", parameters: {...}})'
        }
      }

      // First check if tool exists in the filtered set (respects upstream filtering)
      const toolInContext = searchContext.getToolByName(input.toolName)

      if (!toolInContext) {
        // Tool not found in filtered set - provide semantic suggestions
        const suggestions = await searchContext.getSuggestions(
          input.toolName,
          SUGGESTION_COUNT
        )

        return {
          success: false,
          error: `Tool '${input.toolName}' not found.`,
          suggestions: suggestions.length > 0
            ? {
                message: 'Did you mean one of these tools?',
                tools: suggestions.map(s => ({
                  name: s.name,
                  description: s.description
                }))
              }
            : {
                message: 'Use searchTools to discover available tools.'
              }
        }
      }

      // Get the actual tool with .run() method from the registry
      // The tools passed through the flow don't have .run() because they're
      // transformed by mapAgentToolsToFlowTools which strips the function
      const tool = getToolByNameFromRegistry(input.toolName, workspaceId)

      if (!tool) {
        return {
          success: false,
          error: `Tool '${input.toolName}' found in search context but not in registry. This is an internal error.`,
          toolName: input.toolName
        }
      }

      // Execute the tool
      try {
        const result = await tool.run(input.parameters, {
          requestId,
          workspaceId,
          flowAPI // Pass FlowAPI so tools like askForInput can use it
        })

        // Use toModelResult if available to reduce token overhead
        if (tool.toModelResult) {
          const transformed = tool.toModelResult(result)
          return {
            success: true,
            toolName: input.toolName,
            result: transformed.minimal
          }
        }

        return {
          success: true,
          toolName: input.toolName,
          result
        }
      } catch (error: any) {
        return {
          success: false,
          toolName: input.toolName,
          error: error?.message || String(error)
        }
      }
    }
  }
}

/**
 * Node implementation
 */
export const semanticToolsNode: NodeFunction = async (flow, context, _dataIn, inputs, config) => {
  // Get context - use pushed context, or pull if edge connected
  const executionContext = context ?? (inputs.has('context') ? await inputs.pull('context') : null)

  if (!executionContext) {
    throw new Error('semanticTools node requires a context input. Connect a context source.')
  }

  const workspaceId = flow.workspaceId || process.cwd()

  // Pull tools from upstream Tools node (required input)
  let inputTools: AgentTool[] = []
  if (inputs.has('tools')) {
    const pulledTools = await inputs.pull('tools')
    if (Array.isArray(pulledTools)) {
      inputTools = pulledTools
    }
  }

  if (inputTools.length === 0) {
    flow.log.warn?.('semanticTools: No tools received from input. Connect a Tools node to provide tools.')
    // Return empty tools - the LLM will get searchTools/executeTool but they won't find anything
  }

  // Create semantic search context from input tools
  const searchContext = new SemanticSearchContext(inputTools)

  // Build the two meta-tools
  const searchToolsTool = buildSearchToolsTool(searchContext, config)
  const executeToolTool = buildExecuteToolTool(searchContext, flow.requestId, workspaceId, flow)

  const metaTools = [searchToolsTool, executeToolTool]

  // Append semantic tools instructions to context system instructions
  // Use custom instructions from config, or default
  const semanticInstructions = config.systemInstructions || DEFAULT_SYSTEM_INSTRUCTIONS

  // Check if instructions already contain the Tool Discovery Protocol to avoid duplication
  // This can happen when session context is restored from a previous run
  const existingInstructions = executionContext?.systemInstructions || ''
  const alreadyHasInstructions = existingInstructions.includes('## Tool Discovery Protocol')

  const updatedContext = {
    ...executionContext,
    systemInstructions: alreadyHasInstructions
      ? existingInstructions  // Don't append again
      : (existingInstructions
          ? `${existingInstructions}\n\n${semanticInstructions}`
          : semanticInstructions)
  }

  if (alreadyHasInstructions) {
    flow.log.debug?.('semanticTools: skipping instruction injection (already present from previous run)')
  }

  flow.log.debug?.('semanticTools: providing meta-tools', {
    workspaceId,
    inputToolCount: inputTools.length,
    searchLimit: config.searchLimit || DEFAULT_SEARCH_LIMIT,
    similarityThreshold: config.similarityThreshold || DEFAULT_SIMILARITY_THRESHOLD
  })

  return {
    context: updatedContext,
    tools: metaTools,
    status: 'success'
  }
}
