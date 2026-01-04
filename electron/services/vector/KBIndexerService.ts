import { Service } from '../base/Service.js';
import { getKnowledgeBaseService, getVectorService } from '../index.js';
import crypto from 'node:crypto';

interface KBIndexerState {
  indexedArticles: Record<string, string>; // kbId -> hash
}

export class KBIndexerService extends Service<KBIndexerState> {
  constructor() {
    super({
      indexedArticles: {}
    }, 'kb_indexer');
  }

  onStateChange(): void {
    this.persistState();
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
    
    const allItems = kbService.getItems();
    const items = Object.values(allItems);
    console.log(`[KBIndexerService] Discovered ${items.length} articles to index.`);

    // Note: KB indexing is usually much faster than code, but we still report it
    if (force) {
        console.log('[KBIndexerService] Forced re-index: clearing article hashes...');
        this.setState({ indexedArticles: {} });
        await this.persistState();
        // Clear status for clean start
        await vs.updateIndexingStatus('kb', 0, 0);
        // Wait a moment for persistence to settle
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Signal table-specific start
    await vs.startTableIndexing('kb');

    vs.updateIndexingStatus('kb', 0, items.length);

    const batchSize = 5;
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        await Promise.all(batch.map((item: any) => this.indexArticle(workspaceRoot, item.id, force)));
        
        const indexedCount = Math.min(i + batchSize, items.length);
        vs.updateIndexingStatus('kb', indexedCount, items.length);

        // Yield to maintain responsiveness
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    vs.updateIndexingStatus('kb', items.length, items.length);
  }

    async indexArticle(_workspaceRoot: string, kbId: string, force = false) {
        const kbService = getKnowledgeBaseService();
        const vs = getVectorService();
        try {
            const allItems = kbService.getItems();
            const result = allItems[kbId];
            const meta = result as any;
            const body = (result as any).body || '';
            const content = `${meta.title}\nTags: ${(meta.tags || []).join(', ')}\n\n${body}`;
            const hash = crypto.createHash('md5').update(content).digest('hex');

            if (!force && this.state.indexedArticles[kbId] === hash) {
                return; // Unchanged
            }

            const chunks = this.chunkMarkdown(body, meta);
            
                await vs.upsertItems(chunks.map((c, i) => ({
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

            this.setState({
                indexedArticles: {
                    ...this.state.indexedArticles,
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

  async reset() {
    console.log('[KBIndexerService] Resetting state.');
    this.setState({ indexedArticles: {} });
    await this.persistState();
  }
}
