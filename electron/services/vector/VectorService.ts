import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import fs from 'fs/promises';
import { getEmbeddingService, getWorkspaceService } from '../index.js';

export interface VectorItem {
  id: string;
  vector: number[];
  text: string;
  type: 'code' | 'kb' | 'memory';
  filePath?: string;
  symbolName?: string;
  symbolType?: string;
  startLine?: number;
  endLine?: number;
  kbId?: string;
  articleTitle?: string;
  metadata: string; // JSON string
}

export class VectorService {
  private db: lancedb.Connection | null = null;
  private tableName = 'vectors';
  private initPromise: Promise<void> | null = null;
  private tableInitPromise: Promise<lancedb.Table> | null = null;
  private state = {
    initialized: false,
    indexing: false,
    lastIndexedAt: null as number | null,
    status: {
      indexing: false,
      progress: 0,
      totalFiles: 0,
      indexedFiles: 0,
      sources: {} as Record<string, { total: number; indexed: number }>
    }
  };

  private async ensureInitialized(): Promise<void> {
    if (this.db) return;
    
    if (this.initPromise) {
      await this.initPromise;
      if (this.db) return;
    }

    const ws = getWorkspaceService();
    const workspaces = ws.getAllWindowWorkspaces();
    const activePath = Object.values(workspaces)[0];

    if (!activePath) {
      throw new Error('No active workspace found for VectorService initialization.');
    }

    console.log(`[VectorService] DB missing, attempting late init with: ${activePath}`);
    await this.init(activePath);
  }

  async init(workspaceRoot: string): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const dbPath = path.join(workspaceRoot, '.hifide', 'vectors');
        await fs.mkdir(dbPath, { recursive: true });
        
        console.log(`[VectorService] Connecting to LanceDB at: ${dbPath}`);
        this.db = await lancedb.connect(dbPath);
        
        this.state.initialized = true;
        console.log('[VectorService] Database initialized successfully.');
      } catch (error) {
        console.error('[VectorService] Initialization failed:', error);
        this.db = null;
        this.initPromise = null;
        throw error;
      }
    })();

    return this.initPromise;
  }

  async getOrCreateTable(): Promise<lancedb.Table> {
    await this.ensureInitialized();
    if (this.tableInitPromise) return await this.tableInitPromise;

    this.tableInitPromise = (async () => {
      if (!this.db) throw new Error('Database not connected');
      const expectedDim = await getEmbeddingService().getDimension();
      
      try {
        const tableNames = await this.db.tableNames();
        if (tableNames.includes(this.tableName)) {
          const table = await this.db.openTable(this.tableName);
          const schema = await table.schema();
          
          const fields = (schema as any).fields || [];
          const vectorField = fields.find((f: any) => f.name === 'vector');
          
          if (vectorField && vectorField.type && vectorField.type.listSize !== expectedDim) {
            console.warn(`[VectorService] Dimension mismatch detected (Table: ${vectorField.type.listSize}, Model: ${expectedDim}). Recreating table.`);
            await this.db.dropTable(this.tableName);
            return await this.createInitialTable(expectedDim);
          }
          
          return table;
        }
        return await this.createInitialTable(expectedDim);
      } catch (e) {
        return await this.createInitialTable(expectedDim);
      }
    })();

    return await this.tableInitPromise;
  }

  private async createInitialTable(dim: number): Promise<lancedb.Table> {
    console.log('[VectorService] Creating new vectors table...');
    const seedVector = new Array(dim).fill(0);
    const seed = {
      id: 'seed',
      vector: seedVector,
      text: '',
      type: 'memory',
      filePath: '',
      symbolName: '',
      symbolType: '',
      startLine: 0,
      endLine: 0,
      kbId: '',
      articleTitle: '',
      metadata: JSON.stringify({ isSeed: true })
    };
    
    try {
      return await this.db!.createTable(this.tableName, [seed as any]);
    } catch (err: any) {
      if (err.message?.includes('already exists')) {
        return await this.db!.openTable(this.tableName);
      }
      throw err;
    }
  }

  async search(query: string, limit: number = 10, filter?: string) {
    try {
      const table = await this.getOrCreateTable();
      const embeddingService = getEmbeddingService();
      const queryVector = await embeddingService.embed(query);
      
      const safeLimit = Math.max(1, Math.floor(Number(limit) || 10));
      
      console.log(`[VectorService] Executing search for: "${query}" (limit: ${safeLimit}, filter: ${filter})`);

      let queryBuilder = (table as any).search(queryVector);
      if (typeof queryBuilder.metric === 'function') {
        queryBuilder = queryBuilder.metric('cosine');
      }
      
      if (filter) {
        queryBuilder = queryBuilder.where(filter);
      }

      const results = await queryBuilder.limit(safeLimit).execute();
      
      const rawResults = Array.isArray(results) ? results : (results as any).toArray ? (results as any).toArray() : [];

      return rawResults
        .filter((r: any) => r.id !== 'seed')
        .map((r: any) => {
          let meta = {};
          try {
            meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata || {};
          } catch {
            meta = {};
          }
          
          return {
            id: r.id,
            score: r._distance !== undefined ? 1 - r._distance : 0,
            text: r.text,
            type: r.type,
            filePath: r.filePath,
            symbolName: r.symbolName,
            symbolType: r.symbolType,
            articleTitle: r.articleTitle,
            metadata: meta
          };
        });
    } catch (error) {
      console.error('[VectorService] search error:', error);
      throw error;
    }
  }

  async upsertItems(items: Array<Omit<VectorItem, 'vector' >>) {
    await this.ensureInitialized();
    const table = await this.getOrCreateTable();
    const embeddingService = getEmbeddingService();

    const vectors = await Promise.all(items.map(item => embeddingService.embed(item.text)));
    
    const data = items.map((item, i) => ({
      ...item,
      vector: vectors[i],
      metadata: typeof item.metadata === 'string' ? item.metadata : JSON.stringify(item.metadata)
    }));

    await table.add(data as any);
  }

  getState() {
    return this.state;
  }

  async purge() {
    await this.ensureInitialized();
    if (this.db) {
      try {
        await this.db.dropTable(this.tableName);
        this.tableInitPromise = null;
      } catch (e) {
        // Table might not exist
      }
    }
    this.state.status.sources = {};
    this.state.status.totalFiles = 0;
    this.state.status.indexedFiles = 0;
    this.state.status.progress = 0;
  }

  updateIndexingStatus(source: string, indexed: number, total: number) {
    this.state.status.sources[source] = { indexed, total };
    
    let globalTotal = 0;
    let globalIndexed = 0;
    
    Object.values(this.state.status.sources).forEach(s => {
      globalTotal += s.total;
      globalIndexed += s.indexed;
    });

    this.state.status.totalFiles = globalTotal;
    this.state.status.indexedFiles = globalIndexed;
    this.state.status.progress = globalTotal > 0 ? Math.floor((globalIndexed / globalTotal) * 100) : 0;
    this.state.indexing = globalIndexed < globalTotal;
    this.state.status.indexing = this.state.indexing;

    const ws = getWorkspaceService();
    const workspaces = ws.getAllWindowWorkspaces();
    const activePath = Object.values(workspaces)[0];
    if (activePath) {
      import('../../backend/ws/broadcast.js').then(({ broadcastWorkspaceNotification }) => {
        broadcastWorkspaceNotification(activePath, 'vector_service.changed', this.state);
      });
    }
  }
}