import * as lancedb from '@lancedb/lancedb';
import OpenAI from 'openai';
import { Service } from '../base/Service.js';
import { getSettingsService } from '../index.js';
import path from 'node:path';
import fs from 'node:fs/promises';

export interface VectorMatch {
    id: string;
    score: number;
    text: string;
    type: string;
    metadata: any;
}

export interface VectorItem {
    id: string;
    vector: number[];
    text: string;
    type: 'code' | 'kb' | 'memory';
    metadata: string; // JSON string for metadata
}

interface VectorState {
    initialized: boolean;
    indexing: boolean;
    lastIndexedAt: number | null;
}

export class VectorService extends Service<VectorState> {
    private db: lancedb.Connection | null = null;
    private openai: OpenAI | null = null;
    private tableName = 'vectors';

    constructor() {
        super({
            initialized: false,
            indexing: false,
            lastIndexedAt: null
        }, 'vector_service');
    }

    protected onStateChange(): void {
        this.persistState();
    }

    async init(workspaceRoot: string) {
        if (this.state.initialized) return;

        try {
            const vectorDir = path.join(workspaceRoot, '.hifide', 'vectors');
            await fs.mkdir(vectorDir, { recursive: true });
            
            this.db = await lancedb.connect(vectorDir);
            
            const apiKeys = getSettingsService().getApiKeys();
            if (apiKeys?.openai) {
                this.openai = new OpenAI({ apiKey: apiKeys.openai });
            }

            this.setState({ initialized: true });
        } catch (error) {
            console.error('[VectorService] Failed to initialize:', error);
            throw error;
        }
    }

    private async getOpenAIClient(): Promise<OpenAI> {
        if (this.openai) return this.openai;
        
        const apiKeys = getSettingsService().getApiKeys();
        if (apiKeys?.openai) {
            this.openai = new OpenAI({ apiKey: apiKeys.openai });
            return this.openai;
        }
        
        throw new Error('OpenAI API key not found');
    }

    async getEmbeddings(text: string): Promise<number[]> {
        const client = await this.getOpenAIClient();
        const response = await client.embeddings.create({
            model: 'text-embedding-3-small',
            input: text,
        });
        return response.data[0].embedding;
    }

    async upsertItems(items: Array<Omit<VectorItem, 'vector'>>) {
        if (!this.db) throw new Error('VectorService not initialized');

        const table = await this.getOrCreateTable();
        
        const itemsWithVectors: VectorItem[] = [];
        for (const item of items) {
            const vector = await this.getEmbeddings(item.text);
            itemsWithVectors.push({
                ...item,
                vector
            });
        }

        await table.add(itemsWithVectors as any);
    }

    async search(query: string, limit: number = 10, filter?: string): Promise<VectorMatch[]> {
        if (!this.db) throw new Error('VectorService not initialized');

        const table = await this.getOrCreateTable();
        const queryVector = await this.getEmbeddings(query);

        let queryBuilder = table.vectorSearch(queryVector).limit(limit);
        
        if (filter) {
            queryBuilder = queryBuilder.where(filter);
        }

        const results = await queryBuilder.toArray();

        return results.map((r: any) => ({
            id: r.id,
            score: r._distance,
            text: r.text,
            type: r.type,
            metadata: JSON.parse(r.metadata || '{}')
        }));
    }

    private async getOrCreateTable(): Promise<lancedb.Table> {
        if (!this.db) throw new Error('VectorService not initialized');

        const tableNames = await this.db.tableNames();
        if (tableNames.includes(this.tableName)) {
            return await this.db.openTable(this.tableName);
        }

        // Create table with dummy item to define schema
        // text-embedding-3-small has 1536 dimensions
        const dummyItem: VectorItem = {
            id: 'dummy',
            vector: new Array(1536).fill(0),
            text: '',
            type: 'code',
            metadata: '{}'
        };

        return await this.db.createTable(this.tableName, [dummyItem as any]);
    }
}

export const vectorService = new VectorService();
