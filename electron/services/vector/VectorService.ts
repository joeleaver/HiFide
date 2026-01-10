import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { getEmbeddingService } from '../index.js';

const DEBUG_VECTOR = process.env.HF_VECTOR_DEBUG === '1';

export type TableType = 'code' | 'kb' | 'memories' | 'tools';

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

interface VectorWorkspaceState {
  db: lancedb.Connection | null;
  tablePromises: Map<string, Promise<lancedb.Table>>;
  initPromise: Promise<void> | null;
  deferIndexing: Set<TableType>;
  tablesWithIndex: Set<TableType>;
  initialized: boolean;
  indexing: boolean;
  lastIndexedAt: number | null;
  status: {
    indexing: boolean;
    progress: number;
    totalFiles: number;
    indexedFiles: number;
    activeTable: TableType | 'all' | null;
    sources: Record<string, { total: number; indexed: number }>;
    tables: {
      code: TableStatus;
      kb: TableStatus;
      memories: TableStatus;
      tools: TableStatus;
    };
  };
}

export class VectorService {
  private workspaces = new Map<string, VectorWorkspaceState>();

  /**
   * Generate workspace-specific table name
   * Includes workspace hash to ensure isolation
   */
  private getTableName(workspaceRoot: string, type: TableType): string {
    const normalized = path.resolve(workspaceRoot);
    const hash = crypto.createHash('md5').update(normalized).digest('hex').substring(0, 8);

    const baseNames: Record<TableType, string> = {
      code: 'code_vectors',
      kb: 'kb_vectors',
      memories: 'memory_vectors',
      tools: 'tools_vectors'
    };

    return `${baseNames[type]}_${hash}`;
  }

  /**
   * Get table config for a workspace and type
   */
  private getTableConfig(workspaceRoot: string, type: TableType): TableConfig {
    return {
      tableName: this.getTableName(workspaceRoot, type),
      modelName: 'default',
      dimensions: 0,
      enabled: true
    };
  }

  private getWorkspaceState(workspaceRoot: string): VectorWorkspaceState {
    const normalized = path.resolve(workspaceRoot);
    let state = this.workspaces.get(normalized);
    if (!state) {
      state = {
        db: null,
        tablePromises: new Map(),
        initPromise: null,
        deferIndexing: new Set(),
        tablesWithIndex: new Set(),
        initialized: false,
        indexing: false,
        lastIndexedAt: null,
        status: {
          indexing: false,
          progress: 0,
          totalFiles: 0,
          indexedFiles: 0,
          activeTable: null,
          sources: {},
          tables: {
            code: { count: 0, indexedAt: null, exists: false },
            kb: { count: 0, indexedAt: null, exists: false },
            memories: { count: 0, indexedAt: null, exists: false },
            tools: { count: 0, indexedAt: null, exists: false },
          }
        }
      };
      this.workspaces.set(normalized, state);
    }
    return state;
  }

  private async ensureInitialized(workspaceRoot: string): Promise<VectorWorkspaceState> {
    const state = this.getWorkspaceState(workspaceRoot);
    if (state.db) return state;
    
    if (state.initPromise) {
      await state.initPromise;
      if (state.db) return state;
    }

    if (DEBUG_VECTOR) console.log(`[VectorService] DB missing, attempting late init with: ${workspaceRoot}`);
    await this.init(workspaceRoot);
    return state;
  }

  async init(workspaceRoot: string): Promise<void> {
    const state = this.getWorkspaceState(workspaceRoot);
    if (state.initPromise) return state.initPromise;

    state.initPromise = (async () => {
      try {
        const dbPath = path.join(workspaceRoot, '.hifide-private', 'vectors');
        await fs.mkdir(dbPath, { recursive: true });

        if (DEBUG_VECTOR) console.log(`[VectorService] Connecting to LanceDB at: ${dbPath}`);
        state.db = await lancedb.connect(dbPath);

        state.initialized = true;
        await this.refreshTableStats(workspaceRoot);
        if (DEBUG_VECTOR) console.log(`[VectorService] Database initialized successfully for: ${workspaceRoot}`);
      } catch (error) {
        console.error(`[VectorService] Initialization failed for ${workspaceRoot}:`, error);
        state.db = null;
        state.initPromise = null;
        throw error;
      }
    })();

    return state.initPromise;
  }

  async getOrCreateTable(workspaceRoot: string, type: TableType): Promise<lancedb.Table> {
    const state = await this.ensureInitialized(workspaceRoot);
    const config = this.getTableConfig(workspaceRoot, type);

    if (state.tablePromises.has(config.tableName)) {
      return await state.tablePromises.get(config.tableName)!;
    }

    const promise = (async () => {
      if (!state.db) throw new Error(`Database not connected for workspace: ${workspaceRoot}`);
      const expectedDim = await getEmbeddingService().getDimension(type);
      config.dimensions = expectedDim; // Track dimension in config

      try {
        const tableNames = await state.db.tableNames();
        if (tableNames.includes(config.tableName)) {
          if (DEBUG_VECTOR) console.log(`[VectorService] Opening existing table ${config.tableName} (expected dim: ${expectedDim})`);
          const table = await state.db.openTable(config.tableName);
          const schema = await table.schema();

          const fields = (schema as any).fields || [];
          const vectorField = fields.find((f: any) => f.name === 'vector');

          if (vectorField && vectorField.type && vectorField.type.listSize !== expectedDim) {
            console.warn(`[VectorService] Dimension mismatch in ${config.tableName}. Recreating.`);
            await state.db.dropTable(config.tableName);
            return await this.createInitialTable(workspaceRoot, type, expectedDim);
          }

          return table;
        }
        return await this.createInitialTable(workspaceRoot, type, expectedDim);
      } catch (e) {
        return await this.createInitialTable(workspaceRoot, type, expectedDim);
      }
    })();

    state.tablePromises.set(config.tableName, promise);
    return await promise;
  }

  private async createInitialTable(workspaceRoot: string, type: TableType, dim: number): Promise<lancedb.Table> {
    const state = this.getWorkspaceState(workspaceRoot);
    const config = this.getTableConfig(workspaceRoot, type);
    if (DEBUG_VECTOR) console.log(`[VectorService] Creating new table: ${config.tableName} in ${workspaceRoot}`);
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
      return await state.db!.createTable(config.tableName, [seed as any]);
    } catch (err: any) {
      if (err.message?.includes('already exists')) {
        return await state.db!.openTable(config.tableName);
      }
      throw err;
    }
  }

  async search(workspaceRoot: string, query: string, limit: number = 10, type?: TableType | 'all', filter?: string) {
    try {
      const allTableTypes: TableType[] = ['code', 'kb', 'memories'];
      const typesToSearch: TableType[] = (type === 'all' || !type)
        ? allTableTypes
        : [type];
        
      const embeddingService = getEmbeddingService();
      const queryVector = await embeddingService.embed(query);
      const safeLimit = Math.max(1, Math.floor(Number(limit) || 10));

      if (DEBUG_VECTOR) console.log(`[VectorService] Executing search in ${workspaceRoot} for: "${query}" (limit: ${safeLimit}, tables: ${typesToSearch.join(', ')})`);

      const searchPromises = typesToSearch.map(async (t) => {
        try {
          const table = await this.getOrCreateTable(workspaceRoot, t);
          // Re-embed specifically for this table's model if queryVector dimension doesn't match
          const tableDim = await getEmbeddingService().getDimension(t);
          let tableQueryVector = queryVector;

          if (queryVector.length !== tableDim) {
            if (DEBUG_VECTOR) console.log(`[VectorService] Search vector dim mismatch for ${t} (${queryVector.length} vs ${tableDim}). Re-embedding.`);
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

      if (process.env.HF_FLOW_DEBUG === '1' && processed.length > 0) {
        console.log('[VectorService] First processed result keys:', Object.keys(processed[0]));
        console.log('[VectorService] First processed result snippet:', String(processed[0].text || '').substring(0, 50));
      }

      return processed;
    } catch (error) {
      console.error('[VectorService] search error:', error);
      throw error;
    }
  }

  async deleteItems(workspaceRoot: string, type: TableType, filter: string): Promise<void> {
    try {
      const table = await this.getOrCreateTable(workspaceRoot, type);
      await table.delete(filter);
      await this.refreshTableStats(workspaceRoot);
    } catch (error) {
      console.warn(`[VectorService] Failed to delete items from ${type} table in ${workspaceRoot}.`, error);
    }
  }

  async refreshTableStats(workspaceRoot: string): Promise<void> {
    const state = this.getWorkspaceState(workspaceRoot);
    if (!state.db) return;
    try {
      const tableNames = await state.db.tableNames();
      const tableTypes: TableType[] = ['code', 'kb', 'memories', 'tools'];
      for (const type of tableTypes) {
        const config = this.getTableConfig(workspaceRoot, type);
        if (tableNames.includes(config.tableName)) {
          const table = await state.db.openTable(config.tableName);
          const count = await table.countRows();
          // Subtract 1 if the table has a seed row
          const actualCount = count > 0 ? (count - 1) : 0;
          state.status.tables[type] = {
            count: actualCount,
            indexedAt: Date.now(),
            exists: true
          };
        } else {
           state.status.tables[type] = {
            count: 0,
            indexedAt: null,
            exists: false
          };
        }
      }
      this.emitChange(workspaceRoot);
    } catch (e) {
      console.error(`[VectorService] Table stats refresh failed for ${workspaceRoot}:`, e);
    }
  }

  async deferIndexCreation(workspaceRoot: string, type: TableType): Promise<void> {
    const state = this.getWorkspaceState(workspaceRoot);
    if (DEBUG_VECTOR) console.log(`[VectorService] Deferring index creation for table ${type} in ${workspaceRoot}`);
    state.deferIndexing.add(type);
  }

  async finishDeferredIndexing(workspaceRoot: string, type: TableType): Promise<void> {
    const state = this.getWorkspaceState(workspaceRoot);
    if (DEBUG_VECTOR) console.log(`[VectorService] Finishing deferred indexing for table ${type} in ${workspaceRoot}. Creating ANN index...`);
    state.deferIndexing.delete(type);

    const table = await this.getOrCreateTable(workspaceRoot, type);
    await this.createIndexIfNeeded(workspaceRoot, table, type);
  }

  /**
   * Creates an ANN index on the vector column if one doesn't already exist.
   * This prevents redundant index creation on every upsert.
   */
  private async createIndexIfNeeded(workspaceRoot: string, table: lancedb.Table, type: TableType): Promise<void> {
    const state = this.getWorkspaceState(workspaceRoot);
    // Skip if we've already created an index for this table in this session
    if (state.tablesWithIndex.has(type)) {
      if (DEBUG_VECTOR) console.log(`[VectorService] Index already exists for ${type} in ${workspaceRoot} (cached), skipping creation`);
      return;
    }

    // Check if the table already has a vector index
    try {
      const indices = await table.listIndices();
      const hasVectorIndex = indices.some((idx: { columns?: string[]; name?: string }) =>
        idx.columns?.includes('vector') || idx.name === 'vector_idx'
      );

      if (hasVectorIndex) {
        if (DEBUG_VECTOR) console.log(`[VectorService] Index already exists for ${type} in ${workspaceRoot} (from listIndices), skipping creation`);
        state.tablesWithIndex.add(type);
        return;
      }
    } catch (err: any) {
      // listIndices may not be available in older versions, continue to check row count
      if (DEBUG_VECTOR) console.log(`[VectorService] Could not list indices for ${type} in ${workspaceRoot}:`, err.message);
    }

    // Check if we have enough rows for index creation
    const rowCount = await table.countRows();
    if (rowCount < 256) {
      if (DEBUG_VECTOR) console.log(`[VectorService] Skipping index for ${type} in ${workspaceRoot}: only ${rowCount} rows (requires 256).`);
      return;
    }

    if (DEBUG_VECTOR) console.log(`[VectorService] Creating ANN index for ${type} in ${workspaceRoot} (rows: ${rowCount})...`);
    try {
      await table.createIndex('vector', {
        config: lancedb.Index.ivfPq({
          numPartitions: 2,
          numSubVectors: 2,
        }),
      });
      state.tablesWithIndex.add(type);
      if (DEBUG_VECTOR) console.log(`[VectorService] Successfully created ANN index for ${type} in ${workspaceRoot}`);
    } catch (err: any) {
      // If the error indicates the index already exists, mark it as created
      if (err.message?.includes('already exists') || err.message?.includes('already indexed')) {
        if (DEBUG_VECTOR) console.log(`[VectorService] Index already exists for ${type} in ${workspaceRoot} (from error), marking as created`);
        state.tablesWithIndex.add(type);
      } else {
        console.warn(`[VectorService] Failed to create index for ${type} in ${workspaceRoot}:`, err.message);
      }
    }
  }

  private emitChange(workspaceRoot: string) {
    const state = this.getWorkspaceState(workspaceRoot);
    import('../../backend/ws/broadcast.js').then(({ broadcastWorkspaceNotification }) => {
      broadcastWorkspaceNotification(workspaceRoot, 'vector_service.changed', {
        workspaceId: workspaceRoot,
        initialized: state.initialized,
        indexing: state.indexing,
        lastIndexedAt: state.lastIndexedAt,
        status: state.status
      });
    });
  }

  getState(workspaceRoot: string) {
    const state = this.getWorkspaceState(workspaceRoot);
    return {
      initialized: state.initialized,
      indexing: state.indexing,
      lastIndexedAt: state.lastIndexedAt,
      status: state.status
    };
  }

  async upsertItems(workspaceRoot: string, items: Array<Omit<VectorItem, 'vector' >>, type: TableType = 'code') {
    const state = await this.ensureInitialized(workspaceRoot);
    const table = await this.getOrCreateTable(workspaceRoot, type);
    const embeddingService = getEmbeddingService();

    // DEBUG: To isolate if embedding is the cause of the crash, we can flip this to true
    const DISABLE_EMBEDDING_DEBUG = false;

    let data;
    if (DISABLE_EMBEDDING_DEBUG) {
      if (DEBUG_VECTOR) console.log(`[VectorService] DEBUG: Embedding is DISABLED. Using zero-vectors.`);
      const expectedDim = await embeddingService.getDimension(type);
      const zeroVector = new Array(expectedDim).fill(0);
      data = items.map((item) => ({
        ...item,
        vector: zeroVector,
        metadata: typeof item.metadata === 'string' ? item.metadata : JSON.stringify(item.metadata)
      }));
    } else {
      const vectors = await Promise.all(items.map(async (item, idx) => {
        try {
          // Pass the type so EmbeddingService uses the correct model (e.g., codeLocalModel for 'code')
          return await embeddingService.embed(item.text, type);
        } catch (err) {
          console.error(`[VectorService] Failed to embed item ${idx}:`, err);
          throw err;
        }
      }));

      data = items.map((item, i) => ({
        ...item,
        vector: vectors[i],
        metadata: typeof item.metadata === 'string' ? item.metadata : JSON.stringify(item.metadata)
      }));
    }

    await table.add(data as any);

    // Only create index if we're not in deferred indexing mode
    // During bulk indexing, we defer index creation until the end to save memory and CPU
    if (!state.deferIndexing.has(type)) {
      await this.createIndexIfNeeded(workspaceRoot, table, type);
    }

    await this.refreshTableStats(workspaceRoot);
  }

  async startTableIndexing(workspaceRoot: string, type: TableType | 'all') {
    const state = this.getWorkspaceState(workspaceRoot);
    state.status.activeTable = type;
    state.indexing = true;
    state.status.indexing = true;
    state.status.progress = 0;
    state.status.indexedFiles = 0;
    state.status.totalFiles = 0;
    state.status.sources = {};
    this.emitChange(workspaceRoot);
  }

  async purge(workspaceRoot: string, type?: TableType) {
    const state = await this.ensureInitialized(workspaceRoot);
    if (state.db) {
      const allTableTypes: TableType[] = ['code', 'kb', 'memories', 'tools'];
      const typesToPurge = type ? [type] : allTableTypes;
      for (const t of typesToPurge) {
        const config = this.getTableConfig(workspaceRoot, t);
        try {
          await state.db.dropTable(config.tableName);
          state.tablePromises.delete(config.tableName);
          // Clear the index cache for this table since it was dropped
          state.tablesWithIndex.delete(t);
        } catch (e) {
          // Table might not exist
        }
      }
    }
    state.status.sources = {};
    state.status.totalFiles = 0;
    state.status.indexedFiles = 0;
    state.status.progress = 0;
  }

  async updateIndexingStatus(workspaceRoot: string, source: string, indexed: number, total: number) {
    const state = this.getWorkspaceState(workspaceRoot);
    state.status.sources[source] = { indexed, total };
    
    let globalTotal = 0;
    let globalIndexed = 0;
    
    Object.values(state.status.sources).forEach(s => {
      globalTotal += s.total;
      globalIndexed += s.indexed;
    });

    state.status.totalFiles = globalTotal;
    state.status.indexedFiles = globalIndexed;
    state.status.progress = globalTotal > 0 ? Math.floor((globalIndexed / globalTotal) * 100) : 0;
    
    // We only set indexing to false if ALL tables currently being tracked are finished.
    // However, if we're doing a multi-table index, we don't want to flip to false
    // just because one table finishes (e.g. KB finishes before Code).
    
    const isActuallyIndexing = Object.values(state.status.sources).some(s => s.indexed < s.total);
    state.indexing = isActuallyIndexing;
    state.status.indexing = isActuallyIndexing;

    if (!isActuallyIndexing) {
      state.status.activeTable = null;
      await this.refreshTableStats(workspaceRoot);
    }

    this.emitChange(workspaceRoot);
  }

  /**
   * Get all unique file paths indexed in a specific table
   * Used for startup indexing check to identify missing files
   */
  async getIndexedFilePaths(workspaceRoot: string, type: TableType = 'code'): Promise<Set<string>> {
    try {
      await this.ensureInitialized(workspaceRoot);
      const table = await this.getOrCreateTable(workspaceRoot, type);
      
      // Query all rows and extract unique filePath values
      // Using SQL-like query with SELECT to avoid loading all vector data
      const results = await (table as any).query().select(['filePath']).toArray();
      
      const filePaths = new Set<string>();
      for (const row of results) {
        if (row.filePath && typeof row.filePath === 'string' && !row.filePath.startsWith('seed-')) {
          filePaths.add(row.filePath);
        }
      }
      
      if (DEBUG_VECTOR) console.log(`[VectorService] Found ${filePaths.size} unique indexed files in ${type} table`);
      return filePaths;
    } catch (error) {
      console.error(`[VectorService] Failed to get indexed file paths from ${type}:`, error);
      return new Set();
    }
  }
}