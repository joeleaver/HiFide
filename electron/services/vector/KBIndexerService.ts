import { VectorService } from './VectorService.js';
import { Service } from '../base/Service.js';
import { listItems, readById } from '../../store/utils/knowledgeBase.js';
import crypto from 'node:crypto';

interface IndexerState {
    indexedArticles: Record<string, string>; // kbId -> hash
}

export class KBIndexerService extends Service<IndexerState> {
    constructor(private vectorService: VectorService) {
        super({
            indexedArticles: {}
        }, 'kb_indexer');
    }

    protected onStateChange(): void {
        this.persistState();
    }

    async indexWorkspace(workspaceRoot: string) {
        const items = await listItems(workspaceRoot);
        for (const item of items) {
            await this.indexArticle(workspaceRoot, item.id);
        }
    }

    async indexArticle(workspaceRoot: string, kbId: string) {
        try {
            const result = await readById(workspaceRoot, kbId);
            if (!result) return;

            const { meta, body } = result;
            const content = `${meta.title}\nTags: ${meta.tags.join(', ')}\n\n${body}`;
            const hash = crypto.createHash('md5').update(content).digest('hex');

            if (this.state.indexedArticles[kbId] === hash) {
                return; // Unchanged
            }

            const chunks = this.chunkMarkdown(body, meta);
            
            await this.vectorService.upsertItems(chunks.map((c, i) => ({
                id: `kb:${kbId}:${i}`,
                text: c.text,
                type: 'kb',
                metadata: JSON.stringify({
                    kbId,
                    title: meta.title,
                    tags: meta.tags,
                    section: c.section
                })
            })));

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
        
        // Always add the title and summary as one chunk
        chunks.push({
            text: `Knowledge Base: ${meta.title}\nTags: ${meta.tags.join(', ')}\n\n${body.slice(0, 1000)}`,
            section: 'Introduction'
        });

        // Split by headers
        const sections = body.split(/\n(?=#+\s)/);
        if (sections.length > 1) {
            for (const section of sections) {
                if (section.trim().length > 50) {
                    const headerMatch = section.match(/^#+\s+(.*)/);
                    const sectionTitle = headerMatch ? headerMatch[1] : undefined;
                    chunks.push({
                        text: `Knowledge Base: ${meta.title}\nSection: ${sectionTitle || 'Content'}\n\n${section}`,
                        section: sectionTitle
                    });
                }
            }
        }

        return chunks;
    }
}
