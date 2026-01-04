import { Service } from '../base/Service.js';
import { getVectorService } from '../index.js';
import { readWorkspaceMemories } from '../../store/utils/memories.js';
import crypto from 'node:crypto';

interface MemoriesIndexerState {
  indexedItems: Record<string, string>; // memoryId -> hash
}

export class MemoriesIndexerService extends Service<MemoriesIndexerState> {
  private abortController: AbortController | null = null;

  constructor() {
    super({
      indexedItems: {}
    }, 'memories_indexer');
  }

  onStateChange(): void {
    this.persistState();
  }

  async indexWorkspace(workspaceRoot: string, force = false) {
    const vs = getVectorService();
    
    const root = workspaceRoot;

    if (!root) {
      console.warn('[MemoriesIndexerService] Cannot index: workspaceRoot is required');
      return;
    }

    try {
      await vs.init(root);
    } catch (error) {
      console.error('[MemoriesIndexerService] Failed to initialize VectorService for indexing:', error);
      return;
    }

    const memoriesFile = await readWorkspaceMemories(root);
    const items = memoriesFile.items || [];
    console.log(`[MemoriesIndexerService] Discovered ${items.length} memory items to index.`);

    if (force) {
        console.log('[MemoriesIndexerService] Forced re-index: clearing memory hashes...');
        this.setState({ indexedItems: {} });
        await this.persistState();
        vs.updateIndexingStatus('memories', 0, 0);
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    vs.updateIndexingStatus('memories', 0, items.length);

    const batchSize = 10;
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        
        const upserts = batch
          .filter(item => {
            const hash = crypto.createHash('md5').update(item.text).digest('hex');
            if (!force && this.state.indexedItems[item.id] === hash) {
              return false;
            }
            return true;
          })
          .map(item => {
            const hash = crypto.createHash('md5').update(item.text).digest('hex');
            // Update local state hash
            this.state.indexedItems[item.id] = hash;
            
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
          await vs.upsertItems(upserts, 'memories');
          await this.persistState();
        }
        
        const indexedCount = Math.min(i + batchSize, items.length);
        vs.updateIndexingStatus('memories', indexedCount, items.length);

        // Yield to maintain responsiveness
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    vs.updateIndexingStatus('memories', items.length, items.length);
    console.log(`[MemoriesIndexerService] Completed indexing for ${items.length} items.`);
  }

  async stop() {
    // Stop processing but preserve state for resume
    console.log('[MemoriesIndexerService] Stopping memories indexing...');
    this.abortController?.abort();
    this.abortController = new AbortController();
  }

  async reset() {
    console.log('[MemoriesIndexerService] Resetting state.');
    this.setState({ indexedItems: {} });
    await this.persistState();
  }
}
