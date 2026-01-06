import { Service } from '../base/Service.js';
import { getKnowledgeBaseService, getVectorService } from '../index.js';
import crypto from 'node:crypto';

interface KBIndexerWorkspaceState {
  indexedArticles: Record<string, string>; // kbId -> hash
}

interface KBIndexerState {
  workspaces: Record<string, KBIndexerWorkspaceState>;
}

export class KBIndexerService extends Service<KBIndexerState> {
  private abortController: AbortController | null = null;

  constructor() {
    super({
      workspaces: {}
    }, 'kb_indexer');
  }

  onStateChange(): void {
    this.persistState();
  }

  private getWorkspaceState(workspaceRoot: string): KBIndexerWorkspaceState {
    return this.state.workspaces[workspaceRoot] || { indexedArticles: {} };
  }

  private updateWorkspaceState(workspaceRoot: string, updates: Partial<KBIndexerWorkspaceState>) {
    const prev = this.getWorkspaceState(workspaceRoot);
    this.setState({
      workspaces: {
        ...this.state.workspaces,
        [workspaceRoot]: { ...prev, ...updates }
      }
    });
  }

  async indexWorkspace(workspaceRoot: string, force = false) {
    const vs = getVectorService();

    if (!workspaceRoot) {
      console.warn('[KBIndexerService] Cannot index: workspaceRoot is required');
      return;
    }

    // Ensure the vector service is initialized for this workspace before proceeding
    try {
      await vs.init(workspaceRoot);
    } catch (error) {
      console.error('[KBIndexerService] Failed to initialize VectorService for indexing:', error);
      return;
    }

    const kbService = getKnowledgeBaseService();
    
    // Explicitly sync from disk to ensure we have the latest items before indexing
    await kbService.syncFromDisk(workspaceRoot);
    
    const allItems = kbService.getItems(workspaceRoot);
    const items = Object.values(allItems);
    console.log(`[KBIndexerService] Discovered ${items.length} articles to index.`);

    // Note: KB indexing is usually much faster than code, but we still report it
    if (force) {
        console.log('[KBIndexerService] Forced re-index: clearing article hashes...');
        this.updateWorkspaceState(workspaceRoot, { indexedArticles: {} });
        await this.persistState();
        // Clear status for clean start
        await vs.updateIndexingStatus(workspaceRoot, 'kb', 0, 0);
        // Wait a moment for persistence to settle
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Signal table-specific start
    await vs.startTableIndexing(workspaceRoot, 'kb');

    vs.updateIndexingStatus(workspaceRoot, 'kb', 0, items.length);

    const batchSize = 5;
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        await Promise.all(batch.map((item: any) => this.indexArticle(workspaceRoot, item.id, force)));
        
        const indexedCount = Math.min(i + batchSize, items.length);
        vs.updateIndexingStatus(workspaceRoot, 'kb', indexedCount, items.length);

        // Yield to maintain responsiveness
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    vs.updateIndexingStatus(workspaceRoot, 'kb', items.length, items.length);
  }

    async indexArticle(workspaceRoot: string, kbId: string, force = false) {
        const kbService = getKnowledgeBaseService();
        const vs = getVectorService();
        try {
            const allItems = kbService.getItems(workspaceRoot);
            const result = allItems[kbId];
            if (!result) return;
            const meta = result as any;
            const body = (result as any).body || '';
            const content = `${meta.title}\nTags: ${(meta.tags || []).join(', ')}\n\n${body}`;
            const hash = crypto.createHash('md5').update(content).digest('hex');

            const wsState = this.getWorkspaceState(workspaceRoot);
            if (!force && wsState.indexedArticles[kbId] === hash) {
                return; // Unchanged
            }

            const chunks = this.chunkMarkdown(body, meta);
            
                await vs.upsertItems(workspaceRoot, chunks.map((c, i) => ({
                id: `kb:${kbId}:${i}`,
                text: c.text,
                type: 'kb',
                kbId: kbId,
                articleTitle: meta.title,
                metadata: JSON.stringify({
                    kbId,
                    title: meta.title,
                    tags: meta.tags,
                    section: c.section
                })
            })), 'kb');

            const currentWsState = this.getWorkspaceState(workspaceRoot);
            this.updateWorkspaceState(workspaceRoot, {
                indexedArticles: {
                    ...currentWsState.indexedArticles,
                    [kbId]: hash
                }
            });
        } catch (error) {
            console.error(`[KBIndexerService] Failed to index article ${kbId}:`, error);
        }
    }

    private chunkMarkdown(body: string, meta: any) {
        const chunks: Array<{ text: string; section?: string }> = [];
        const kbPrefix = `Knowledge Base: ${meta.title}\nTags: ${(meta.tags || []).join(', ')}\n\n`;
        const fullContent = `${kbPrefix}${body}`;

        // Slidding window chunking for better semantic density
        const chunkSize = 1000;
        const overlap = 200;

        if (fullContent.length <= chunkSize) {
            chunks.push({ text: fullContent, section: 'Full content' });
        } else {
            for (let i = 0; i < fullContent.length; i += (chunkSize - overlap)) {
                const chunkText = fullContent.substring(i, i + chunkSize);
                if (chunkText.length < 100) continue; // Skip tiny tails
                chunks.push({
                    text: chunkText,
                    section: `Fragment ${Math.floor(i / (chunkSize - overlap)) + 1}`
                });
            }
        }

    return chunks;
  }

  async stop() {
    // Stop processing but preserve state for resume
    console.log('[KBIndexerService] Stopping KB indexing...');
    this.abortController?.abort();
    this.abortController = new AbortController();
  }

  async reset(workspaceRoot: string) {
    console.log(`[KBIndexerService] Resetting state for ${workspaceRoot}.`);
    this.updateWorkspaceState(workspaceRoot, { indexedArticles: {} });
    await this.persistState();
  }

  removeArticle(workspaceRoot: string, id: string) {
    const wsState = this.getWorkspaceState(workspaceRoot);
    if (wsState.indexedArticles[id]) {
      const { [id]: _, ...rest } = wsState.indexedArticles;
      this.updateWorkspaceState(workspaceRoot, { indexedArticles: rest });
    }
  }
}
