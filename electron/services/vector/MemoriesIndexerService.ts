import { Service } from '../base/Service.js';
import { getVectorService } from '../index.js';
import { readWorkspaceMemories } from '../../store/utils/memories.js';
import crypto from 'node:crypto';
import path from 'node:path';

interface MemoriesIndexerWorkspaceState {
  indexedItems: Record<string, string>; // memoryId -> hash
}

interface MemoriesIndexerState {
  workspaces: Record<string, MemoriesIndexerWorkspaceState>;
}

export class MemoriesIndexerService extends Service<MemoriesIndexerState> {
  private abortController: AbortController | null = null;
  private pendingPersist: NodeJS.Timeout | null = null;

  constructor() {
    super({
      workspaces: {}
    }, 'memories_indexer');
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

  /**
   * Normalize workspace path for consistent state storage
   */
  private normalizePath(workspaceRoot: string): string {
    return path.resolve(workspaceRoot);
  }

  private getWorkspaceState(workspaceRoot: string): MemoriesIndexerWorkspaceState {
    const normalized = this.normalizePath(workspaceRoot);
    return this.state.workspaces[normalized] || { indexedItems: {} };
  }

  private updateWorkspaceState(workspaceRoot: string, updates: Partial<MemoriesIndexerWorkspaceState>) {
    const normalized = this.normalizePath(workspaceRoot);
    const prev = this.getWorkspaceState(normalized);
    this.setState({
      workspaces: {
        ...this.state.workspaces,
        [normalized]: { ...prev, ...updates }
      }
    });
  }

  async indexWorkspace(workspaceRoot: string, force = false) {
    const vs = getVectorService();
    const root = this.normalizePath(workspaceRoot);

    if (!workspaceRoot) {
      console.warn('[MemoriesIndexerService] Cannot index: workspaceRoot is required');
      return;
    }

    // Create new abort controller for this indexing run
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      await vs.init(root);
    } catch (error) {
      console.error('[MemoriesIndexerService] Failed to initialize VectorService for indexing:', error);
      return;
    }

    const memoriesFile = await readWorkspaceMemories(root);
    const items = memoriesFile.items || [];
    console.log(`[MemoriesIndexerService] [${root}] Discovered ${items.length} memory items to index.`);

    if (force) {
        console.log('[MemoriesIndexerService] Forced re-index: clearing memory hashes...');
        this.updateWorkspaceState(root, { indexedItems: {} });
        await this.persistState();
        vs.updateIndexingStatus(root, 'memories', 0, 0);
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    vs.updateIndexingStatus(root, 'memories', 0, items.length);

    const wsState = this.getWorkspaceState(root);
    const newIndexedItems = { ...wsState.indexedItems };

    const batchSize = 10;
    for (let i = 0; i < items.length; i += batchSize) {
        // Check for abort signal
        if (signal.aborted) {
          console.log('[MemoriesIndexerService] Indexing aborted');
          return;
        }

        const batch = items.slice(i, i + batchSize);

        const upserts = batch
          .filter(item => {
            const hash = crypto.createHash('md5').update(item.text).digest('hex');
            if (!force && newIndexedItems[item.id] === hash) {
              return false;
            }
            return true;
          })
          .map(item => {
            const hash = crypto.createHash('md5').update(item.text).digest('hex');
            newIndexedItems[item.id] = hash;

            return {
              id: item.id,
              text: item.text,
              type: 'memories' as const,
              metadata: JSON.stringify({
                id: item.id,
                type: item.type,
                tags: item.tags,
                importance: item.importance,
                source: item.source,
                createdAt: item.createdAt
              })
            };
          });

        if (upserts.length > 0) {
          await vs.upsertItems(root, upserts, 'memories');
          this.updateWorkspaceState(root, { indexedItems: newIndexedItems });
          // Persistence is now debounced in onStateChange
        }

        const indexedCount = Math.min(i + batchSize, items.length);
        vs.updateIndexingStatus(root, 'memories', indexedCount, items.length);

        // Yield to maintain responsiveness
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    vs.updateIndexingStatus(root, 'memories', items.length, items.length);
    console.log(`[MemoriesIndexerService] [${root}] Completed indexing for ${items.length} items.`);
  }

  async stop() {
    // Stop processing but preserve state for resume
    console.log('[MemoriesIndexerService] Stopping memories indexing...');
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
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
      console.log(`[MemoriesIndexerService] Resetting state for ${normalized}.`);
      this.updateWorkspaceState(normalized, { indexedItems: {} });
    } else {
      console.log('[MemoriesIndexerService] Resetting all state.');
      this.setState({ workspaces: {} });
    }
    await this.persistState();
  }

  removeItem(workspaceRoot: string, id: string) {
    const normalized = this.normalizePath(workspaceRoot);
    const wsState = this.getWorkspaceState(normalized);
    if (wsState.indexedItems[id]) {
      const { [id]: _, ...rest } = wsState.indexedItems;
      this.updateWorkspaceState(normalized, { indexedItems: rest });
    }
  }
}
