import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
// import fsPromises from 'node:fs/promises';
import { Service } from '../base/Service.js';
import { WatcherService } from './WatcherService.js';
import { IndexingQueue } from './IndexingQueue.js';
import { getVectorService, getEmbeddingService, getSettingsService } from '../index.js'; // Assuming this exists or I import from vector/VectorService
import { IndexingEvent } from './types.js';

interface OrchestratorWorkspaceState {
    status: 'idle' | 'indexing' | 'paused';
    processedCount: number;
    totalCount: number;
    totalFilesDiscovered: number;
    // Detailed counts for UI
    code: {
        total: number;
        indexed: number;
        missing: number;
        stale: number;
    };
    kb: {
        total: number;
        indexed: number;
        missing: number;
        stale: number;
    };
    memories: {
        total: number;
        indexed: number;
        missing: number;
        stale: number;
    };
    indexingEnabled: boolean;
    queue: IndexingQueue;
    watcher: WatcherService;
    indexedCount: number;
    watcherHandlerRegistered: boolean;
    activeWorkers: number;
}

interface OrchestratorState {
    workspaces: Record<string, OrchestratorWorkspaceState>;
}

export class IndexOrchestrator extends Service<OrchestratorState> {
    private workers: Worker[] = [];
    private globalActiveWorkers = 0;
    private maxWorkers = 4;
    private workerRequestMap = new Map<string, { resolve: (val: any) => void, reject: (err: any) => void }>();
    private reqId = 0;

    constructor() {
        super({
            workspaces: {}
        }, 'index_orchestrator');

        this.loadSettings();
    }

    private getWorkspaceState(rootPath: string): OrchestratorWorkspaceState {
        const normalized = path.resolve(rootPath);
        if (!this.state.workspaces[normalized]) {
            const wsState: OrchestratorWorkspaceState = {
                status: 'idle',
                processedCount: 0,
                totalCount: 0,
                totalFilesDiscovered: 0,
                code: { total: 0, indexed: 0, missing: 0, stale: 0 },
                kb: { total: 0, indexed: 0, missing: 0, stale: 0 },
                memories: { total: 0, indexed: 0, missing: 0, stale: 0 },
                indexingEnabled: true,
                queue: new IndexingQueue(),
                watcher: new WatcherService(),
                indexedCount: 0,
                watcherHandlerRegistered: false,
                activeWorkers: 0
            };
            this.setState({
                workspaces: {
                    ...this.state.workspaces,
                    [normalized]: wsState
                }
            });
            return wsState;
        }
        return this.state.workspaces[normalized];
    }

    private updateWorkspaceState(rootPath: string, updates: Partial<OrchestratorWorkspaceState>) {
        const normalized = path.resolve(rootPath);
        const prev = this.getWorkspaceState(normalized);
        const next = { ...prev, ...updates };
        this.setState({
            workspaces: {
                ...this.state.workspaces,
                [normalized]: next
            }
        });
        return next;
    }

    private loadSettings(): void {
        try {
            const settingsService = getSettingsService();
            const vectorSettings = settingsService.getState().vector;
            
            const indexingWorkers = vectorSettings?.indexingWorkers;
            if (indexingWorkers !== undefined && indexingWorkers > 0) {
                this.maxWorkers = indexingWorkers;
                console.log(`[IndexOrchestrator] Loaded settings: maxWorkers = ${this.maxWorkers}`);
            }
        } catch (err) {
            console.warn('[IndexOrchestrator] Failed to load settings, using defaults:', err);
        }
    }

    protected onStateChange(_updates: Partial<OrchestratorState>, _prevState: OrchestratorState): void {
        // No persistence needed yet
    }

    async init() {
        // Terminate any existing workers first to allow for dynamic reconfiguration
        if (this.workers.length > 0) {
            console.log(`[IndexOrchestrator] Terminating ${this.workers.length} existing workers before init...`);
            const terminatePromises = this.workers.map(worker => 
                worker.terminate().catch(err => 
                    console.warn('[IndexOrchestrator] Failed to terminate worker:', err)
                )
            );
            await Promise.all(terminatePromises);
            this.workers = [];
            this.globalActiveWorkers = 0;
        }

        // Initialize workers
        const workerPath = this.getWorkerPath();
        console.log(`[IndexOrchestrator] Initializing ${this.maxWorkers} parser workers...`);
        
        let execArgv: string[] | undefined = undefined;
        if (workerPath.endsWith('.ts')) {
            // Use absolute path for ts-node to avoid resolution issues in Electron environment
            const tsNodePath = path.join(process.cwd(), 'node_modules', 'ts-node', 'register.js');
            execArgv = ['-r', tsNodePath];
        }

        for (let i = 0; i < this.maxWorkers; i++) {
            const worker = new Worker(workerPath, {
                execArgv
            });
            
            worker.on('message', (msg) => {
                if (msg.type === 'result') {
                    const req = this.workerRequestMap.get(msg.id);
                    if (req) {
                        this.workerRequestMap.delete(msg.id);
                        req.resolve(msg.result);
                    }
                }
            });
            
            this.workers.push(worker);
        }
    }

    async getStats(rootPath: string) {
        const ws = this.getWorkspaceState(rootPath);
        return {
            fileCount: 0,
            chunkCount: 0,
            queueLength: ws.queue.getQueueLength(),
            isProcessing: this.isWsProcessing(rootPath),
            currentTask: this.isWsProcessing(rootPath) ? 'Indexing...' : 'Idle'
        };
    }

    private emitStatus(rootPath: string) {
        const ws = this.getWorkspaceState(rootPath);
        this.emit('index-orchestrator-status', {
            workspaceId: rootPath,
            isProcessing: this.isWsProcessing(rootPath),
            currentTask: this.isWsProcessing(rootPath) ? 'Indexing...' : 'Idle',
            queueLength: (ws.queue as any).state.queue.length,
            indexedCount: ws.indexedCount,
            code: ws.code,
            kb: ws.kb,
            memories: ws.memories,
            indexingEnabled: ws.indexingEnabled
        });
    }

    private isWsProcessing(rootPath: string): boolean {
        const ws = this.getWorkspaceState(rootPath);
        return (ws.queue as any).getQueueLength() > 0 || ws.activeWorkers > 0;
    }

    /**
     * Start the file watcher for the given workspace path
     * This is always called on workspace startup, regardless of indexing state
     */
    async startWatcher(rootPath: string): Promise<void> {
        const ws = this.getWorkspaceState(rootPath);
        if (this.workers.length === 0) await this.init();
        
        console.log('[IndexOrchestrator] Starting file watcher for:', rootPath);

        if (!ws.watcherHandlerRegistered) {
            ws.watcher.on('events', (events: IndexingEvent[]) => {
                console.log(`[IndexOrchestrator] [${rootPath}] Received ${events.length} file events`);
                
                let indexedDelta = 0;
                let missingDelta = 0;
                let totalDelta = 0;

                for (const event of events) {
                    if (event.type === 'change') {
                        indexedDelta--;
                    } else if (event.type === 'unlink') {
                        indexedDelta--;
                        totalDelta--;
                    } else if (event.type === 'add') {
                        totalDelta++;
                        missingDelta++;
                    }
                }

                if (indexedDelta !== 0 || missingDelta !== 0 || totalDelta !== 0) {
                    this.updateWorkspaceState(rootPath, {
                        code: {
                            total: Math.max(0, ws.code.total + totalDelta),
                            indexed: Math.max(0, ws.code.indexed + indexedDelta),
                            missing: Math.max(0, ws.code.missing + missingDelta),
                            stale: ws.code.stale
                        }
                    });
                }

                ws.queue.push(events);
                this.processQueue(rootPath);
                this.emitStatus(rootPath);
            });
            this.updateWorkspaceState(rootPath, { watcherHandlerRegistered: true });
        }

        await ws.watcher.start(rootPath);
        
        const watcherReadyPromise = new Promise<number>((resolve) => {
            const onReady = (data?: { totalFiles: number }) => {
                const totalFiles = data?.totalFiles || 0;
                console.log('[IndexOrchestrator] Watcher ready with', totalFiles, 'files for:', rootPath);
                ws.watcher.off('ready', onReady);
                resolve(totalFiles);
            };
            ws.watcher.on('ready', onReady);
        });

        const totalFiles = await watcherReadyPromise;
        this.updateWorkspaceState(rootPath, { totalFilesDiscovered: totalFiles });
    }

    /**
     * Check for missing files, KB articles, and memories
     * Also detects and cleans up stale index entries (items that no longer exist)
     * Updates state with counts of total vs indexed items
     */
    async checkMissingItems(rootPath: string): Promise<void> {
        if (!rootPath) return;

        console.log(`[IndexOrchestrator] Checking for missing and stale items in ${rootPath}...`);
        const vectorService = getVectorService();

        const codeIndexed = await vectorService.getIndexedFilePaths(rootPath, 'code');
        const codeDiscovered = await this.discoverWorkspaceFiles(rootPath);

        const toRelativePath = (absolutePath: string) => {
            return path.relative(rootPath, absolutePath).replace(/\\/g, '/');
        };

        const codeIndexedLower = new Set([...codeIndexed].map(p => p.toLowerCase()));
        const codeDiscoveredLower = new Set(codeDiscovered.map(p => toRelativePath(p).toLowerCase()));

        const codeMissing = codeDiscovered.filter(absolutePath => {
            const relativePath = toRelativePath(absolutePath);
            return !codeIndexedLower.has(relativePath.toLowerCase());
        });

        const codeStale = [...codeIndexed].filter(indexedPath => {
            return !codeDiscoveredLower.has(indexedPath.toLowerCase());
        });

        const codeIndexedCount = codeDiscovered.length - codeMissing.length;

        this.updateWorkspaceState(rootPath, {
            code: {
                total: codeDiscovered.length,
                indexed: codeIndexedCount,
                missing: codeMissing.length,
                stale: codeStale.length
            },
            totalFilesDiscovered: codeDiscovered.length
        });

        const kbIndexed = await vectorService.getIndexedFilePaths(rootPath, 'kb');
        const kbDiscovered = await this.discoverKbArticles(rootPath);
        const kbDiscoveredSet = new Set(kbDiscovered);
        const kbMissing = kbDiscovered.filter(id => !kbIndexed.has(id));
        const kbStale = [...kbIndexed].filter(id => !kbDiscoveredSet.has(id));
        const kbIndexedCount = kbDiscovered.length - kbMissing.length;

        this.updateWorkspaceState(rootPath, {
            kb: {
                total: kbDiscovered.length,
                indexed: kbIndexedCount,
                missing: kbMissing.length,
                stale: kbStale.length
            }
        });

        const memoriesIndexed = await vectorService.getIndexedFilePaths(rootPath, 'memories');
        const memoriesDiscovered = await this.discoverMemories(rootPath);
        const memoriesDiscoveredSet = new Set(memoriesDiscovered);
        const memoriesMissing = memoriesDiscovered.filter(id => !memoriesIndexed.has(id));
        const memoriesStale = [...memoriesIndexed].filter(id => !memoriesDiscoveredSet.has(id));
        const memoriesIndexedCount = memoriesDiscovered.length - memoriesMissing.length;

        this.updateWorkspaceState(rootPath, {
            memories: {
                total: memoriesDiscovered.length,
                indexed: memoriesIndexedCount,
                missing: memoriesMissing.length,
                stale: memoriesStale.length
            }
        });

        await this.cleanupStaleEntries(rootPath, vectorService, codeStale, kbStale, memoriesStale);
        this.emitStatus(rootPath);
    }

    /**
     * Remove stale entries from the vector database
     */
    private async cleanupStaleEntries(
        rootPath: string,
        vectorService: ReturnType<typeof getVectorService>,
        codeStale: string[],
        kbStale: string[],
        memoriesStale: string[]
    ): Promise<void> {
        if (codeStale.length > 0) {
            console.log(`[IndexOrchestrator] [${rootPath}] Removing ${codeStale.length} stale code entries...`);
            for (const filePath of codeStale) {
                try {
                    const escapedPath = filePath.replace(/'/g, "''");
                    await vectorService.deleteItems(rootPath, 'code', `"filePath" = '${escapedPath}'`);
                } catch (err) {
                    console.error(`[IndexOrchestrator] Failed to delete stale code entry ${filePath}:`, err);
                }
            }
        }

        if (kbStale.length > 0) {
            console.log(`[IndexOrchestrator] [${rootPath}] Removing ${kbStale.length} stale KB entries...`);
            const { getKBIndexerService } = await import('../index.js');
            const kbIndexer = getKBIndexerService();
            for (const kbId of kbStale) {
                try {
                    const escapedId = kbId.replace(/'/g, "''");
                    await vectorService.deleteItems(rootPath, 'kb', `id LIKE 'kb:${escapedId}:%'`);
                    kbIndexer.removeArticle(rootPath, kbId);
                } catch (err) {
                    console.error(`[IndexOrchestrator] Failed to delete stale KB entry ${kbId}:`, err);
                }
            }
        }

        if (memoriesStale.length > 0) {
            console.log(`[IndexOrchestrator] [${rootPath}] Removing ${memoriesStale.length} stale memory entries...`);
            const { getMemoriesIndexerService } = await import('../index.js');
            const memoriesIndexer = getMemoriesIndexerService();
            for (const memoryId of memoriesStale) {
                try {
                    const escapedId = memoryId.replace(/'/g, "''");
                    await vectorService.deleteItems(rootPath, 'memories', `id = '${escapedId}'`);
                    memoriesIndexer.removeItem(memoryId);
                } catch (err) {
                    console.error(`[IndexOrchestrator] Failed to delete stale memory entry ${memoryId}:`, err);
                }
            }
        }
    }

    /**
     * Discover all KB articles in the workspace
     */
    private async discoverKbArticles(rootPath: string): Promise<string[]> {
        try {
            const { discoverWorkspaceFiles } = await import('../../utils/fileDiscovery.js');
            const kbPath = path.join(rootPath, '.hifide-public', 'kb');
            
            // Check if KB directory exists
            const fs = await import('fs');
            if (!fs.existsSync(kbPath)) {
                return [];
            }
            
            // Discover all markdown files in KB
            const kbArticles = await (discoverWorkspaceFiles as any)({
                cwd: kbPath,
                includeGlobs: ['**/*.md'],
                absolute: true
            });
            
            // Extract article IDs from file paths
            const articleIds = kbArticles.map((filePath: string) => {
                const relativePath = path.relative(kbPath, filePath);
                // Remove .md extension
                return relativePath.replace(/\.md$/, '');
            });
            
            return articleIds;
        } catch (error) {
            console.error('[IndexOrchestrator] Failed to discover KB articles:', error);
            return [];
        }
    }

    /**
     * Discover all memories in the workspace
     */
    private async discoverMemories(rootPath: string): Promise<string[]> {
        try {
            // Memories are stored in .hifide-public/memories.json as a JSON file with items array
            const memoriesPath = path.join(rootPath, '.hifide-public', 'memories.json');

            const fsPromises = await import('fs/promises');
            try {
                const raw = await fsPromises.readFile(memoriesPath, 'utf8');
                const json = JSON.parse(raw);
                // Extract memory IDs from the items array
                const items = json.items || [];
                return items.map((item: { id: string }) => item.id);
            } catch (e: any) {
                if (e?.code === 'ENOENT') {
                    // File doesn't exist yet - no memories to discover
                    return [];
                }
                throw e;
            }
        } catch (error) {
            console.error('[IndexOrchestrator] Failed to discover memories:', error);
            return [];
        }
    }

    private getWorkerPath(): string {
        let baseDir = '';
        try {
            baseDir = path.dirname(fileURLToPath(import.meta.url));
        } catch {
            baseDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
        }
        
        const candidates = [
            path.join(process.cwd(), 'dist-electron/workers/indexing/v2-parser-worker.mjs'), // Vite build (Dev & Prod)
            path.join(baseDir, '../../workers/indexing/v2-parser-worker.js'),
            path.join(baseDir, '../../workers/indexing/v2-parser-worker.ts'), 
            path.join(process.cwd(), 'dist-electron/workers/indexing/v2-parser-worker.js'),
            path.join(process.cwd(), 'electron/workers/indexing/v2-parser-worker.ts'),
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) return candidate;
        }
        throw new Error('Could not find v2-parser-worker');
    }

    async start(rootPath: string) {
        const ws = this.getWorkspaceState(rootPath);
        if (this.workers.length === 0) await this.init();
        await ws.watcher.start(rootPath);
        this.updateWorkspaceState(rootPath, { status: 'indexing', indexedCount: 0 });
        this.emitStatus(rootPath);
    }

    async indexAll(force: boolean = false, rootPath: string) {
        console.log(`[IndexOrchestrator] Re-index requested for ${rootPath} (force=${force})`);
        this.loadSettings();

        await this.stop(rootPath);
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.init();

        const ws = this.getWorkspaceState(rootPath);
        this.updateWorkspaceState(rootPath, { totalFilesDiscovered: 0, indexedCount: 0 });

        if (force) {
            this.updateWorkspaceState(rootPath, {
                code: { total: 0, indexed: 0, missing: 0, stale: 0 },
                kb: { total: 0, indexed: 0, missing: 0, stale: 0 },
                memories: { total: 0, indexed: 0, missing: 0, stale: 0 }
            });
        }

        const watcherReadyPromise = new Promise<number>((resolve) => {
            const onReady = (data?: { totalFiles: number }) => {
                const totalFiles = data?.totalFiles || 0;
                ws.watcher.off('ready', onReady);
                resolve(totalFiles);
            };
            ws.watcher.on('ready', onReady);
        });

        const watcherOptions: any = force ? { ignoreInitial: false } : { ignoreInitial: true };
        await ws.watcher.start(rootPath, watcherOptions);
        const totalFiles = await watcherReadyPromise;

        if (totalFiles > 0) {
            this.updateWorkspaceState(rootPath, { totalFilesDiscovered: totalFiles });
            const vectorService = getVectorService();
            if (vectorService) {
                await vectorService.deferIndexCreation(rootPath, 'code');
                vectorService.updateIndexingStatus(rootPath, 'code', 0, totalFiles);
            }
        }

        this.updateWorkspaceState(rootPath, { status: 'indexing' });
        this.emitStatus(rootPath);
    }

    async stop(rootPath: string) {
        const ws = this.getWorkspaceState(rootPath);
        await ws.watcher.stop();
        this.updateWorkspaceState(rootPath, { status: 'paused' });
        this.emitStatus(rootPath);
    }

    async stopAll() {
        const stopPromises = Object.keys(this.state.workspaces).map(rootPath => 
            this.stop(rootPath)
        );
        return Promise.all(stopPromises) as any;
    }

    setIndexingEnabled(rootPath: string, enabled: boolean) {
        this.updateWorkspaceState(rootPath, { indexingEnabled: enabled });
        this.emitStatus(rootPath);
    }
    
    async stopAndCleanup(rootPath: string) {
        console.log(`[IndexOrchestrator] Stopping and cleaning up indexing for ${rootPath}...`);
        const ws = this.getWorkspaceState(rootPath);
        await ws.watcher.stop();
        ws.queue.clear();
        
        this.updateWorkspaceState(rootPath, { 
            status: 'idle',
            processedCount: 0,
            totalCount: 0,
            totalFilesDiscovered: 0,
            indexedCount: 0
        });
        this.emitStatus(rootPath);
    }

  async runStartupCheck(rootPath: string) {
    if (!rootPath) return;
    const ws = this.getWorkspaceState(rootPath);
    console.log(`[IndexOrchestrator] Running startup check for ${rootPath}, indexingEnabled=${ws.indexingEnabled}`);

    if (!ws.indexingEnabled) {
      this.updateWorkspaceState(rootPath, { status: 'idle' });
      this.emitStatus(rootPath);
      return;
    }

    await this.checkMissingItems(rootPath);
    const totalMissing = ws.code.missing + ws.kb.missing + ws.memories.missing;
    
    if (totalMissing > 0) {
      console.log(`[IndexOrchestrator] Indexing ${totalMissing} missing items on startup in ${rootPath}...`);

      try {
        const { getEmbeddingService, getSettingsService } = await import('../index.js');
        const embeddingService = getEmbeddingService();
        const settings = (getSettingsService() as any).state;
        const modelId = settings?.vector?.codeLocalModel || settings?.vector?.localModel || 'Xenova/all-MiniLM-L6-v2';
        await embeddingService.warmup(modelId);
      } catch (err) {
        console.error('[IndexOrchestrator] Failed to warmup embedding model:', err);
      }

      if (ws.code.missing > 0) {
        const { getVectorService } = await import('../index.js');
        const vectorService = getVectorService();
        const indexedFiles = await vectorService.getIndexedFilePaths(rootPath, 'code');
        const discoveredFiles = await this.discoverWorkspaceFiles(rootPath);

        const toRelativePath = (absolutePath: string) => {
            return path.relative(rootPath, absolutePath).replace(/\\/g, '/');
        };

        const indexedFilesLower = new Set([...indexedFiles].map(p => p.toLowerCase()));
        const missingFiles = discoveredFiles.filter(absolutePath => {
            const relativePath = toRelativePath(absolutePath);
            return !indexedFilesLower.has(relativePath.toLowerCase());
        });

        const events = missingFiles.map(filePath => ({
          type: 'add' as const,
          path: filePath,
          timestamp: Date.now()
        }));
        ws.queue.push(events);
      }
      
      if (ws.kb.missing > 0) {
        const { getKBIndexerService } = await import('../index.js');
        getKBIndexerService().indexWorkspace(rootPath, false).catch(err => {
          console.error('[IndexOrchestrator] KB indexer error:', err);
        });
      }

      if (ws.memories.missing > 0) {
        const { getMemoriesIndexerService } = await import('../index.js');
        getMemoriesIndexerService().indexWorkspace(rootPath, false).catch(err => {
          console.error('[IndexOrchestrator] Memories indexer error:', err);
        });
      }
      
      this.updateWorkspaceState(rootPath, { status: 'indexing' });
      this.processQueue(rootPath);
    } else {
      this.updateWorkspaceState(rootPath, { status: 'idle' });
    }
    
    this.emitStatus(rootPath);
  }

  /**
   * Discover all files in the workspace that should be indexed
   * Uses exclusion-based approach: includes all files except those in 
   * DEFAULT_EXCLUDE_PATTERNS and .gitignore
   * @param rootPath - workspace root directory
   * @param globs - optional array of glob patterns to search (defaults to all files)
   */
  private async discoverWorkspaceFiles(rootPath: string, globs?: string[]): Promise<string[]> {
    try {
      const { discoverWorkspaceFiles } = await import('../../utils/fileDiscovery.js');
      
      // If no globs provided, use default ['**/*'] to include all files
      // The exclusion happens via DEFAULT_EXCLUDE_PATTERNS and .gitignore
      const files = await discoverWorkspaceFiles({
        cwd: rootPath,
        includeGlobs: globs, // undefined defaults to ['**/*'] in fileDiscovery
        respectGitignore: true,
        includeDotfiles: false,
        absolute: true,
      });
      
      return files;
    } catch (error) {
      console.error('[IndexOrchestrator] Failed to discover workspace files:', error);
      return [];
    }
  }

    private async processQueue(rootPath: string) {
        const ws = this.getWorkspaceState(rootPath);
        if (ws.status === 'paused') return;

        while (this.globalActiveWorkers < this.maxWorkers && (ws.queue as any).state.queue.length > 0) {
            const items = ws.queue.pop(1);
            if (items.length === 0) break;
            
            const item = items[0];
            this.globalActiveWorkers++;
            this.updateWorkspaceState(rootPath, { activeWorkers: ws.activeWorkers + 1 });
            
            this.processItem(rootPath, item).finally(() => {
                this.globalActiveWorkers--;
                const currentWs = this.getWorkspaceState(rootPath);
                const newActive = Math.max(0, currentWs.activeWorkers - 1);
                this.updateWorkspaceState(rootPath, { activeWorkers: newActive });
                
                this.processQueue(rootPath);
                this.emitStatus(rootPath);
                
                if (newActive === 0 && (currentWs.queue as any).getQueueLength() === 0 && currentWs.status === 'indexing') {
                    this.onIndexingComplete(rootPath);
                }
            });
        }
        this.emitStatus(rootPath);
    }

    private async onIndexingComplete(rootPath: string) {
        console.log(`[IndexOrchestrator] Indexing complete for ${rootPath}. Creating ANN indexes...`);
        const vectorService = getVectorService();
        if (vectorService) {
            try {
                await vectorService.finishDeferredIndexing(rootPath, 'code');
                console.log(`[IndexOrchestrator] Indexes created successfully for ${rootPath}`);
            } catch (err) {
                console.error(`[IndexOrchestrator] Failed to create indexes for ${rootPath}:`, err);
            }
        }
        
        const embeddingService = getEmbeddingService();
        if (embeddingService) {
            embeddingService.clearCache();
        }
        
        this.updateWorkspaceState(rootPath, { status: 'idle' });
        this.emitStatus(rootPath);
    }

    private async processItem(rootPath: string, item: IndexingEvent) {
        const vectorService = getVectorService();
        if (!vectorService) return;

        if (item.type === 'unlink') {
            try {
                const relativePath = path.relative(rootPath, item.path).replace(/\\/g, '/');
                const escapedPath = relativePath.replace(/'/g, "''");
                await vectorService.deleteItems(rootPath, 'code', `"filePath" = '${escapedPath}'`);
                console.log(`[IndexOrchestrator] Deleted index entry for: ${relativePath}`);
            } catch (err) {
                console.error(`[IndexOrchestrator] Failed to delete ${item.path}:`, err);
            }
            return;
        }

        try {
            const workerIndex = this.reqId % this.workers.length;
            const worker = this.workers[workerIndex];
            const id = (this.reqId++).toString();

            const resultPromise = new Promise<any>((resolve, reject) => {
                this.workerRequestMap.set(id, { resolve, reject });
                setTimeout(() => {
                    if (this.workerRequestMap.has(id)) {
                        this.workerRequestMap.delete(id);
                        reject(new Error('Parser timeout'));
                    }
                }, 30000); 
            });

            worker.postMessage({ 
                type: 'parse', 
                id, 
                filePath: item.path, 
                workspaceRoot: rootPath
            });

            const result = await resultPromise;
            if (result.skipped) return;

            if (result.chunks && result.chunks.length > 0) {
                 const escapedPath = item.path.replace(/'/g, "''");
                 await vectorService.deleteItems(rootPath, 'code', `"filePath" = '${escapedPath}'`);

                 const BATCH_SIZE = 10;
                 for (let i = 0; i < result.chunks.length; i += BATCH_SIZE) {
                     const batch = result.chunks.slice(i, i + BATCH_SIZE);
                     try {
                         await vectorService.upsertItems(rootPath, batch, 'code');
                     } catch (err) {
                         console.error(`[IndexOrchestrator] Failed to upsert batch for ${item.path}:`, err);
                     }
                 }

                 const ws = this.getWorkspaceState(rootPath);
                 const newIndexedCount = ws.indexedCount + 1;
                 const newCodeIndexed = ws.code.indexed + 1;
                 const newCodeMissing = item.type === 'add' ? Math.max(0, ws.code.missing - 1) : ws.code.missing;
                 
                 this.updateWorkspaceState(rootPath, {
                     indexedCount: newIndexedCount,
                     code: { ...ws.code, indexed: newCodeIndexed, missing: newCodeMissing }
                 });

                 vectorService.updateIndexingStatus(rootPath, 'code', newCodeIndexed, ws.code.total);
                 
                 if (newIndexedCount % 50 === 0) {
                     const embeddingService = getEmbeddingService();
                     if (embeddingService) {
                         embeddingService.clearCache();
                     }
                 }
            }
        } catch (error) {
            console.error(`[IndexOrchestrator] Failed to process ${item.path}:`, error);
        }
    }
}
