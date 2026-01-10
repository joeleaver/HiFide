/**
 * ToolsIndexerService
 *
 * Indexes agent tool descriptions into the vector database for semantic search.
 * This enables the semanticTools node to provide tool discovery via natural language queries.
 *
 * Features:
 * - Hash-based change detection (only re-indexes when tools change)
 * - Per-workspace indexing (supports MCP tools that vary by workspace)
 * - Auto-reindex on MCP tool changes via event listener
 */

import { Service } from '../base/Service.js';
import { getVectorService, getMcpService } from '../index.js';
import { getAgentToolSnapshot } from '../../tools/agentToolRegistry.js';
import type { AgentTool } from '../../providers/provider.js';
import crypto from 'node:crypto';
import path from 'node:path';

interface ToolsIndexerWorkspaceState {
  indexedTools: Record<string, string>; // toolName -> hash
}

interface ToolsIndexerState {
  workspaces: Record<string, ToolsIndexerWorkspaceState>;
}

export class ToolsIndexerService extends Service<ToolsIndexerState> {
  private pendingPersist: NodeJS.Timeout | null = null;
  private mcpListenerAttached = false;
  private indexingPromises = new Map<string, Promise<void>>();

  constructor() {
    super({ workspaces: {} }, 'tools_indexer');
  }

  /**
   * Attach to MCP service events for auto-reindex on tool changes.
   * Should be called after MCP service is initialized.
   */
  attachMcpListener(): void {
    if (this.mcpListenerAttached) return;

    try {
      const mcpService = getMcpService();
      mcpService.on('mcp:tools:changed', (payload: any) => {
        const workspaceId = payload?.workspaceId ?? null;
        console.log('[ToolsIndexerService] MCP tools changed, re-indexing...', { workspaceId });
        // Re-index tools for this workspace
        void this.indexWorkspace(workspaceId || undefined, true).catch((err) => {
          console.error('[ToolsIndexerService] Failed to re-index on MCP change:', err);
        });
      });
      this.mcpListenerAttached = true;
      console.log('[ToolsIndexerService] MCP listener attached');
    } catch {
      // MCP service may not be available yet - that's OK
    }
  }

  onStateChange(): void {
    // Debounce persistence to avoid excessive writes during batch indexing
    if (this.pendingPersist) {
      clearTimeout(this.pendingPersist);
    }
    this.pendingPersist = setTimeout(() => {
      this.persistState();
      this.pendingPersist = null;
    }, 1000);
  }

  private normalizePath(workspaceRoot: string): string {
    return path.resolve(workspaceRoot);
  }

  private getWorkspaceState(workspaceRoot: string): ToolsIndexerWorkspaceState {
    const normalized = this.normalizePath(workspaceRoot);
    return this.state.workspaces[normalized] || { indexedTools: {} };
  }

  private updateWorkspaceState(workspaceRoot: string, updates: Partial<ToolsIndexerWorkspaceState>) {
    const normalized = this.normalizePath(workspaceRoot);
    const prev = this.getWorkspaceState(normalized);
    this.setState({
      workspaces: {
        ...this.state.workspaces,
        [normalized]: { ...prev, ...updates }
      }
    });
  }

  /**
   * Build searchable text from a tool definition.
   * Includes name, description, and parameter schema for semantic search.
   */
  private buildToolSearchText(tool: AgentTool): string {
    const parts: string[] = [];

    // Tool name (important for exact matching)
    parts.push(`Tool: ${tool.name}`);

    // Description
    if (tool.description) {
      parts.push(`Description: ${tool.description}`);
    }

    // Parameter names and descriptions for better semantic matching
    if (tool.parameters?.properties) {
      const props = tool.parameters.properties;
      const paramParts = Object.entries(props).map(([name, schema]: [string, any]) => {
        const desc = schema.description || '';
        const type = schema.type || 'any';
        return `  - ${name} (${type}): ${desc}`;
      });
      if (paramParts.length) {
        parts.push('Parameters:');
        parts.push(...paramParts);
      }
    }

    return parts.join('\n');
  }

  /**
   * Create hash of tool for change detection
   */
  private hashTool(tool: AgentTool): string {
    const content = JSON.stringify({
      name: tool.name,
      description: tool.description || '',
      parameters: tool.parameters || {}
    });
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Index all tools for a workspace.
   * Uses hash-based change detection to only re-index changed tools.
   */
  async indexWorkspace(workspaceRoot?: string, force = false): Promise<void> {
    const normalized = workspaceRoot ? this.normalizePath(workspaceRoot) : '__global__';

    // Prevent concurrent indexing for the same workspace
    const existingPromise = this.indexingPromises.get(normalized);
    if (existingPromise) {
      return existingPromise;
    }

    const indexPromise = this._doIndexWorkspace(workspaceRoot, force);
    this.indexingPromises.set(normalized, indexPromise);

    try {
      await indexPromise;
    } finally {
      this.indexingPromises.delete(normalized);
    }
  }

  private async _doIndexWorkspace(workspaceRoot?: string, force = false): Promise<void> {
    const vs = getVectorService();
    const normalized = workspaceRoot ? this.normalizePath(workspaceRoot) : '__global__';

    // Initialize vector service if workspace provided
    if (workspaceRoot) {
      try {
        await vs.init(workspaceRoot);
      } catch (error) {
        console.error('[ToolsIndexerService] Failed to initialize VectorService:', error);
        return;
      }
    }

    // Get all tools for this workspace
    const tools = getAgentToolSnapshot(workspaceRoot || null);
    console.log(`[ToolsIndexerService] Discovered ${tools.length} tools to index for ${normalized}`);

    if (force) {
      console.log('[ToolsIndexerService] Forced re-index: clearing tool hashes...');
      this.updateWorkspaceState(normalized, { indexedTools: {} });
      await this.persistState();
    }

    const wsState = this.getWorkspaceState(normalized);
    const newIndexedTools: Record<string, string> = { ...wsState.indexedTools };

    // Identify tools to upsert
    // Note: toolName is stored in metadata JSON, not as a separate field
    const toUpsert: Array<{
      id: string;
      text: string;
      type: 'tools';
      metadata: string;
    }> = [];

    // Track which tools still exist (for cleanup of removed tools)
    const currentToolNames = new Set<string>();

    for (const tool of tools) {
      currentToolNames.add(tool.name);
      const hash = this.hashTool(tool);

      if (!force && newIndexedTools[tool.name] === hash) {
        continue; // Unchanged
      }

      newIndexedTools[tool.name] = hash;

      toUpsert.push({
        id: `tool:${tool.name}`,
        text: this.buildToolSearchText(tool),
        type: 'tools',
        metadata: JSON.stringify({
          name: tool.name,
          description: tool.description || '',
          parameters: tool.parameters || {}
        })
      });
    }

    // Remove tools that no longer exist
    const removedTools: string[] = [];
    for (const toolName of Object.keys(newIndexedTools)) {
      if (!currentToolNames.has(toolName)) {
        removedTools.push(toolName);
        delete newIndexedTools[toolName];
      }
    }

    if (removedTools.length > 0) {
      console.log(`[ToolsIndexerService] Removing ${removedTools.length} obsolete tools from index`);
      // Delete removed tools from vector store
      const targetWorkspace = workspaceRoot || process.cwd();
      for (const toolName of removedTools) {
        try {
          await vs.deleteItems(targetWorkspace, 'tools', `id = 'tool:${toolName}'`);
        } catch (err) {
          console.warn(`[ToolsIndexerService] Failed to delete tool ${toolName}:`, err);
        }
      }
    }

    if (toUpsert.length > 0) {
      const targetWorkspace = workspaceRoot || process.cwd();
      console.log(`[ToolsIndexerService] Indexing ${toUpsert.length} tools...`);
      await vs.upsertItems(targetWorkspace, toUpsert as any, 'tools');
      console.log(`[ToolsIndexerService] Indexed ${toUpsert.length} tools successfully`);
    }

    this.updateWorkspaceState(normalized, { indexedTools: newIndexedTools });
  }

  /**
   * Search for tools by semantic query.
   * Returns tools with their full metadata including parameter schemas.
   */
  async searchTools(
    workspaceRoot: string,
    query: string,
    options?: { limit?: number; threshold?: number }
  ): Promise<Array<{
    name: string;
    description: string;
    parameters: any;
    score: number;
  }>> {
    const vs = getVectorService();
    const limit = options?.limit || 5;
    const threshold = options?.threshold || 0.3;

    // Ensure tools are indexed before searching
    await this.indexWorkspace(workspaceRoot, false);

    const results = await vs.search(workspaceRoot, query, limit, 'tools');

    return results
      .filter((r: any) => r.score >= threshold)
      .map((r: any) => {
        const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
        return {
          name: meta.name,
          description: meta.description,
          parameters: meta.parameters,
          score: r.score
        };
      });
  }

  /**
   * Get suggestions for a tool name (used for error recovery).
   * Uses lower threshold to provide helpful suggestions even for poor matches.
   */
  async getSuggestions(
    workspaceRoot: string,
    toolName: string,
    limit = 3
  ): Promise<Array<{ name: string; description: string }>> {
    const vs = getVectorService();

    // Use lower threshold for suggestions
    const results = await vs.search(workspaceRoot, toolName, limit, 'tools');

    return results
      .filter((r: any) => r.score >= 0.1) // Very low threshold for suggestions
      .map((r: any) => {
        const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
        return {
          name: meta.name,
          description: meta.description
        };
      });
  }

  async stop() {
    console.log('[ToolsIndexerService] Stopping...');
    // Flush any pending persistence
    if (this.pendingPersist) {
      clearTimeout(this.pendingPersist);
      this.pendingPersist = null;
      await this.persistState();
    }
  }

  async reset(workspaceRoot?: string) {
    if (workspaceRoot) {
      const normalized = this.normalizePath(workspaceRoot);
      console.log(`[ToolsIndexerService] Resetting state for ${normalized}`);
      this.updateWorkspaceState(normalized, { indexedTools: {} });
    } else {
      console.log('[ToolsIndexerService] Resetting all state');
      this.setState({ workspaces: {} });
    }
    await this.persistState();
  }
}
