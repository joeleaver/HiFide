import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import fs from 'fs/promises';
import { getEmbeddingService, getWorkspaceService } from '../index.js';

export type TableType = 'code' | 'kb' | 'memories';

export interface VectorItem {
  id: string;
  vector: number[];
  text: string;
  type: TableType;
  filePath?: string;
  symbolName?: string;
  symbolType?: string;
  startLine?: number;
  endLine?: number;
  kbId?: string;
  articleTitle?: string;
  metadata: string; // JSON string
}

export interface TableStatus {
  count: number;
  indexedAt: number | null;
  exists: boolean;
}

export interface TableConfig {
  tableName: string;
  modelName: string;
  dimensions: number;
  enabled: boolean;
}

export class VectorService {
  private db: lancedb.Connection | null = null;
  private tablePromises: Map<string, Promise<lancedb.Table>> = new Map();
  private initPromise: Promise<void> | null = null;

  private tableConfigs: Record<TableType, TableConfig> = {
    code: { tableName: 'code_vectors', modelName: 'default', dimensions: 0, enabled: true },
    kb: { tableName: 'kb_vectors', modelName: 'default', dimensions: 0, enabled: true },
    memories: { tableName: 'memory_vectors', modelName: 'default', dimensions: 0, enabled: true }
  };
  private state = {
    initialized: false,
    indexing: false,
    lastIndexedAt: null as number | null,
    status: {
      indexing: false,
      progress: 0,
      totalFiles: 0,
      indexedFiles: 0,
      activeTable: null as TableType | 'all' | null,
      sources: {} as Record<string, { total: number; indexed: number }>,
      tables: {
        code: { count: 0, indexedAt: null, exists: false } as TableStatus,
        kb: { count: 0, indexedAt: null, exists: false } as TableStatus,
        memories: { count: 0, indexedAt: null, exists: false } as TableStatus,
      }
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
        const dbPath = path.join(workspaceRoot, '.hifide-private', 'vectors');
        await fs.mkdir(dbPath, { recursive: true });
        
        console.log(`[VectorService] Connecting to LanceDB at: ${dbPath}`);
        this.db = await lancedb.connect(dbPath);
        
        this.state.initialized = true;
        await this.refreshTableStats();
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

  async getOrCreateTable(type: TableType): Promise<lancedb.Table> {
    await this.ensureInitialized();
    const config = this.tableConfigs[type];
    
    if (this.tablePromises.has(config.tableName)) {
      return await this.tablePromises.get(config.tableName)!;
    }

    const promise = (async () => {
      if (!this.db) throw new Error('Database not connected');
      const expectedDim = await getEmbeddingService().getDimension(type);
      config.dimensions = expectedDim; // Track dimension in config
      
      try {
        const tableNames = await this.db.tableNames();
        if (tableNames.includes(config.tableName)) {
          console.log(`[VectorService] Opening existing table ${config.tableName} (expected dim: ${expectedDim})`);
          const table = await this.db.openTable(config.tableName);
          const schema = await table.schema();
          
          const fields = (schema as any).fields || [];
          const vectorField = fields.find((f: any) => f.name === 'vector');
          
          if (vectorField && vectorField.type && vectorField.type.listSize !== expectedDim) {
            console.warn(`[VectorService] Dimension mismatch in ${config.tableName}. Recreating.`);
            await this.db.dropTable(config.tableName);
            return await this.createInitialTable(type, expectedDim);
          }
          
          return table;
        }
        return await this.createInitialTable(type, expectedDim);
      } catch (e) {
        return await this.createInitialTable(type, expectedDim);
      }
    })();

    this.tablePromises.set(config.tableName, promise);
    return await promise;
  }

  private async createInitialTable(type: TableType, dim: number): Promise<lancedb.Table> {
    const config = this.tableConfigs[type];
    console.log(`[VectorService] Creating new table: ${config.tableName}`);
    const seedVector = new Array(dim).fill(0);
    const seed = {
      id: `seed-${type}`,
      vector: seedVector,
      text: '',
      type: type,
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
      return await this.db!.createTable(config.tableName, [seed as any]);
    } catch (err: any) {
      if (err.message?.includes('already exists')) {
        return await this.db!.openTable(config.tableName);
      }
      throw err;
    }
  }

  async search(query: string, limit: number = 10, type?: TableType | 'all', filter?: string) {
    try {
      const typesToSearch: TableType[] = (type === 'all' || !type) 
        ? (Object.keys(this.tableConfigs) as TableType[]) 
        : [type];
        
      const embeddingService = getEmbeddingService();
      const queryVector = await embeddingService.embed(query);
      const safeLimit = Math.max(1, Math.floor(Number(limit) || 10));

      console.log(`[VectorService] Executing search for: "${query}" (limit: ${safeLimit}, tables: ${typesToSearch.join(', ')})`);

      const searchPromises = typesToSearch.map(async (t) => {
        try {
          const table = await this.getOrCreateTable(t);
          // Re-embed specifically for this table's model if queryVector dimension doesn't match
          const tableDim = await getEmbeddingService().getDimension(t);
          let tableQueryVector = queryVector;
          
          if (queryVector.length !== tableDim) {
            console.log(`[VectorService] Search vector dim mismatch for ${t} (${queryVector.length} vs ${tableDim}). Re-embedding.`);
            tableQueryVector = await getEmbeddingService().embed(query, t);
          }

          let queryBuilder = (table as any).search(tableQueryVector);
          
          if (typeof queryBuilder.metric === 'function') {
            queryBuilder = queryBuilder.metric('cosine');
          }
          
          if (filter) {
            // Apply double quotes to filter if it contains cameraCase identifiers 
            // since LanceDB/DataFusion is case-sensitive 
            const sanitizedFilter = filter.includes('filePath') && !filter.includes('"filePath"') 
              ? filter.replace(/filePath/g, '"filePath"')
              : filter;
            queryBuilder = queryBuilder.where(sanitizedFilter);
          }

          const results = await queryBuilder.limit(safeLimit).toArray();
          return results.map((r: any) => ({ ...r, sourceTable: t }));
        } catch (e) {
          console.error(`[VectorService] Search failed for table ${t}:`, e);
          return [];
        }
      });

      const allRawResults = (await Promise.all(searchPromises)).flat();

      const processed = allRawResults
        .filter((r: any) => !r.id.startsWith('seed-'))
        .map((r: any) => {
          const metadataStr = r.metadata;
          let meta = {};
          try {
            meta = typeof metadataStr === 'string' ? JSON.parse(metadataStr) : (metadataStr || {});
          } catch {
            meta = {};
          }
          
          const distance = r._distance ?? 0;
          // LanceDB distance is 0 to 2 for cosine (0 = matching, 2 = opposite).
          // We normalize this to a 0-1 similarity score where 1 is identical.
          const score = Math.max(0, 1 - (distance / 2));
          
          return {
            id: r.id,
            score: score,
            text: String(r.text || ""),
            type: r.type,
      filePath: r.filePath || r.kbId,
      kbId: r.kbId,
            symbolName: r.symbolName,
            symbolType: r.symbolType,
            startLine: r.startLine,
            articleTitle: r.articleTitle,
            metadata: meta
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, safeLimit);

      if (processed.length > 0) {
        console.log('[VectorService] First processed result keys:', Object.keys(processed[0]));
        console.log('[VectorService] First processed result snippet:', String(processed[0].text || '').substring(0, 50));
      }

      return processed;
    } catch (error) {
      console.error('[VectorService] search error:', error);
      throw error;
    }
  }

  async deleteItems(type: TableType, filter: string): Promise<void> {
    try {
      const table = await this.getOrCreateTable(type);
      await table.delete(filter);
      await this.refreshTableStats();
    } catch (error) {
      console.warn(`[VectorService] Failed to delete items from ${type} table. This can happen if the table is outdated or corrupt. Consider re-indexing.`, error);
      // We don't re-throw because a failed deletion shouldn't necessarily halt the orchestrator's queue
    }
  }

  async refreshTableStats(): Promise<void> {
    if (!this.db) return;
    try {
      const tableNames = await this.db.tableNames();
      for (const type of Object.keys(this.tableConfigs) as TableType[]) {
        const config = this.tableConfigs[type];
        if (tableNames.includes(config.tableName)) {
          const table = await this.db.openTable(config.tableName);
          const count = await table.countRows();
          // Subtract 1 if the table has a seed row
          const actualCount = count > 0 ? (count - 1) : 0; 
          this.state.status.tables[type] = {
            count: actualCount,
            indexedAt: Date.now(),
            exists: true
          };
        } else {
           this.state.status.tables[type] = {
            count: 0,
            indexedAt: null,
            exists: false
          };
        }
      }
      this.emitChange();
    } catch (e) {
      console.error('[VectorService] Table stats refresh failed:', e);
    }
  }

  private emitChange() {
    // This is a placeholder for the actual event emission logic 
    // Usually handled by the service registry or bridge
    const ws = getWorkspaceService();
    const workspaces = ws.getAllWindowWorkspaces();
    const activePath = Object.values(workspaces)[0];
    if (activePath) {
      import('../../backend/ws/broadcast.js').then(({ broadcastWorkspaceNotification }) => {
        broadcastWorkspaceNotification(activePath, 'vector_service.changed', this.state);
      });
    }
  }

  getState() {
    return this.state;
  }

  async upsertItems(items: Array<Omit<VectorItem, 'vector' >>, type: TableType = 'code') {
    await this.ensureInitialized();
    const table = await this.getOrCreateTable(type);
    const embeddingService = getEmbeddingService();

    const vectors = await Promise.all(items.map(item => embeddingService.embed(item.text)));
    
    const data = items.map((item, i) => ({
      ...item,
      vector: vectors[i],
      metadata: typeof item.metadata === 'string' ? item.metadata : JSON.stringify(item.metadata)
    }));

    await table.add(data as any);
    await this.refreshTableStats();
  }

  async startTableIndexing(type: TableType | 'all') {
    this.state.status.activeTable = type;
    this.state.indexing = true;
    this.state.status.indexing = true;
    this.state.status.progress = 0;
    this.state.status.indexedFiles = 0;
    this.state.status.totalFiles = 0;
    this.state.status.sources = {};
    this.emitChange();
  }

  async purge(type?: TableType) {
    await this.ensureInitialized();
    if (this.db) {
      const typesToPurge = type ? [type] : (Object.keys(this.tableConfigs) as TableType[]);
      for (const t of typesToPurge) {
        const config = this.tableConfigs[t];
        try {
          await this.db.dropTable(config.tableName);
          this.tablePromises.delete(config.tableName);
        } catch (e) {
          // Table might not exist
        }
      }
    }
    this.state.status.sources = {};
    this.state.status.totalFiles = 0;
    this.state.status.indexedFiles = 0;
    this.state.status.progress = 0;
  }

  async updateIndexingStatus(source: string, indexed: number, total: number) {
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
    
    // We only set indexing to false if ALL tables currently being tracked are finished.
    // However, if we're doing a multi-table index, we don't want to flip to false
    // just because one table finishes (e.g. KB finishes before Code).
    
    const isActuallyIndexing = Object.values(this.state.status.sources).some(s => s.indexed < s.total);
    this.state.indexing = isActuallyIndexing;
    this.state.status.indexing = isActuallyIndexing;

    if (!isActuallyIndexing) {
      this.state.status.activeTable = null;
      await this.refreshTableStats();
    }

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