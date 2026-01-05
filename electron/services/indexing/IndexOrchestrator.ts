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

interface OrchestratorState {
    status: 'idle' | 'indexing' | 'paused';
    processedCount: number;
    totalCount: number;
    totalFilesDiscovered: number;
    // Detailed counts for UI
    code: {
        total: number;
        indexed: number;
        missing: number;
        stale: number;  // Index entries for files that no longer exist
    };
    kb: {
        total: number;
        indexed: number;
        missing: number;
        stale: number;  // Index entries for articles that no longer exist
    };
    memories: {
        total: number;
        indexed: number;
        missing: number;
        stale: number;  // Index entries for memories that no longer exist
    };
    // Overall indexing enabled state
    indexingEnabled: boolean;
}

export class IndexOrchestrator extends Service<OrchestratorState> {
    private watcher: WatcherService;
    private queue: IndexingQueue;
    private workers: Worker[] = [];
    private activeWorkers = 0;
    private maxWorkers = 4;
    private workerRequestMap = new Map<string, { resolve: (val: any) => void, reject: (err: any) => void }>();
    private reqId = 0;
    private indexedCount = 0;
    private rootPath: string | null = null;
    private watcherHandlerRegistered = false;

    constructor() {
        super({
            status: 'idle',
            processedCount: 0,
            totalCount: 0,
            totalFilesDiscovered: 0,
            code: { total: 0, indexed: 0, missing: 0, stale: 0 },
            kb: { total: 0, indexed: 0, missing: 0, stale: 0 },
            memories: { total: 0, indexed: 0, missing: 0, stale: 0 },
            indexingEnabled: true
        }, 'index_orchestrator');

        this.watcher = new WatcherService();
        this.queue = new IndexingQueue();
        this.loadSettings();
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
            
            // Load indexing enabled state
            const indexingEnabled = vectorSettings?.indexingEnabled ?? true;
            this.setState({ indexingEnabled });
            console.log(`[IndexOrchestrator] Loaded settings: indexingEnabled = ${indexingEnabled}`);
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
            this.activeWorkers = 0;
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

        // Hook up watcher event handler (only once)
        // Use a flag to prevent duplicate listeners
        if (!this.watcherHandlerRegistered) {
            this.watcher.on('events', (events: IndexingEvent[]) => {
                console.log(`[IndexOrchestrator] Received ${events.length} file events`);
                // Log top 5 events for debugging
                const topEvents = events.slice(0, 5);
                topEvents.forEach((event, index) => {
                    console.log(`  [${index + 1}/${Math.min(5, events.length)}] ${event.type}: ${event.path}`);
                });
                if (events.length > 5) {
                    console.log(`  ... and ${events.length - 5} more`);
                }

                // Update counts based on event types BEFORE queueing
                // 'change': file was indexed, now stale - decrement indexed only (not missing, it's still in DB)
                // 'unlink': file deleted - decrement indexed and total
                // 'add': new file - increment total and missing
                let indexedDelta = 0;
                let missingDelta = 0;
                let totalDelta = 0;

                for (const event of events) {
                    if (event.type === 'change') {
                        // File changed: was indexed, now stale and needs re-indexing
                        // Don't increment missing - the file IS in the DB, just outdated
                        indexedDelta--;
                    } else if (event.type === 'unlink') {
                        // File deleted: remove from indexed count and total
                        indexedDelta--;
                        totalDelta--;
                    } else if (event.type === 'add') {
                        // New file: add to total and missing
                        totalDelta++;
                        missingDelta++;
                    }
                }

                // Apply deltas to state
                if (indexedDelta !== 0 || missingDelta !== 0 || totalDelta !== 0) {
                    this.setState({
                        code: {
                            total: Math.max(0, this.state.code.total + totalDelta),
                            indexed: Math.max(0, this.state.code.indexed + indexedDelta),
                            missing: Math.max(0, this.state.code.missing + missingDelta),
                            stale: this.state.code.stale  // Preserve stale count
                        }
                    });
                }

                this.queue.push(events);
                this.processQueue();
                this.emitStatus();
            });
            this.watcherHandlerRegistered = true;
        }
    }

    async getStats() {
        const vectorService = getVectorService();
        const vectorStats = vectorService ? { fileCount: 0, chunkCount: 0 } : { fileCount: 0, chunkCount: 0 };
        return {
            ...vectorStats,
            queueLength: this.queue.getQueueLength(),
            isProcessing: this.isProcessing,
            currentTask: this.isProcessing ? 'Indexing...' : 'Idle'
        };
    }

    private emitStatus() {
        this.emit('index-orchestrator-status', {
            isProcessing: this.isProcessing,
            currentTask: this.isProcessing ? 'Indexing...' : 'Idle',
            queueLength: (this.queue as any).state.queue.length,
            indexedCount: this.indexedCount,
            // Detailed counts
            code: this.state.code,
            kb: this.state.kb,
            memories: this.state.memories,
            indexingEnabled: this.state.indexingEnabled
        });
    }

    /**
     * Start the file watcher for the given workspace path
     * This is always called on workspace startup, regardless of indexing state
     */
    async startWatcher(rootPath: string): Promise<void> {
        this.rootPath = rootPath;
        if (this.workers.length === 0) await this.init();
        
        console.log('[IndexOrchestrator] Starting file watcher for:', rootPath);
        await this.watcher.start(rootPath);
        
        // Wait for watcher to discover files
        const watcherReadyPromise = new Promise<number>((resolve) => {
            const onReady = (data?: { totalFiles: number }) => {
                const totalFiles = data?.totalFiles || 0;
                console.log('[IndexOrchestrator] Watcher ready with', totalFiles, 'files');
                this.watcher.off('ready', onReady);
                resolve(totalFiles);
            };
            this.watcher.on('ready', onReady);
        });

        const totalFiles = await watcherReadyPromise;
        this.setState({ totalFilesDiscovered: totalFiles });
    }

    /**
     * Check for missing files, KB articles, and memories
     * Also detects and cleans up stale index entries (items that no longer exist)
     * Updates state with counts of total vs indexed items
     */
    async checkMissingItems(rootPath: string): Promise<void> {
        if (!rootPath) return;

        console.log('[IndexOrchestrator] Checking for missing and stale items...');
        const vectorService = getVectorService();

        // Check code files
        // Note: codeIndexed contains RELATIVE paths with forward slashes (e.g., "src/foo.ts")
        // codeDiscovered contains ABSOLUTE paths (e.g., "C:\Users\...\src\foo.ts")
        // We need to convert discovered paths to relative paths for comparison
        const codeIndexed = await vectorService.getIndexedFilePaths('code');
        const codeDiscovered = await this.discoverWorkspaceFiles(rootPath);

        // Convert absolute discovered paths to relative paths with forward slashes for comparison
        // Also normalize to lowercase for case-insensitive comparison on Windows
        const toRelativePath = (absolutePath: string) => {
            return path.relative(rootPath, absolutePath).replace(/\\/g, '/');
        };

        // Create lowercase Sets for case-insensitive comparison (Windows paths are case-insensitive)
        const codeIndexedLower = new Set([...codeIndexed].map(p => p.toLowerCase()));
        const codeDiscoveredLower = new Set(codeDiscovered.map(p => toRelativePath(p).toLowerCase()));

        const codeMissing = codeDiscovered.filter(absolutePath => {
            const relativePath = toRelativePath(absolutePath);
            return !codeIndexedLower.has(relativePath.toLowerCase());
        });

        // Find stale entries: indexed files that no longer exist on disk
        const codeStale = [...codeIndexed].filter(indexedPath => {
            return !codeDiscoveredLower.has(indexedPath.toLowerCase());
        });

        // Count how many discovered files are already indexed (not the DB size, which may have stale entries)
        const codeIndexedCount = codeDiscovered.length - codeMissing.length;

        this.setState({
            code: {
                total: codeDiscovered.length,
                indexed: codeIndexedCount,
                missing: codeMissing.length,
                stale: codeStale.length
            },
            // Also set totalFilesDiscovered for progress tracking
            totalFilesDiscovered: codeDiscovered.length
        });

        // Check KB articles
        const kbIndexed = await vectorService.getIndexedFilePaths('kb');
        const kbDiscovered = await this.discoverKbArticles(rootPath);
        const kbDiscoveredSet = new Set(kbDiscovered);
        const kbMissing = kbDiscovered.filter(id => !kbIndexed.has(id));
        // Find stale KB entries: indexed articles that no longer exist
        const kbStale = [...kbIndexed].filter(id => !kbDiscoveredSet.has(id));
        const kbIndexedCount = kbDiscovered.length - kbMissing.length;

        this.setState({
            kb: {
                total: kbDiscovered.length,
                indexed: kbIndexedCount,
                missing: kbMissing.length,
                stale: kbStale.length
            }
        });

        // Check memories
        const memoriesIndexed = await vectorService.getIndexedFilePaths('memories');
        const memoriesDiscovered = await this.discoverMemories(rootPath);
        const memoriesDiscoveredSet = new Set(memoriesDiscovered);
        const memoriesMissing = memoriesDiscovered.filter(id => !memoriesIndexed.has(id));
        // Find stale memory entries: indexed memories that no longer exist
        const memoriesStale = [...memoriesIndexed].filter(id => !memoriesDiscoveredSet.has(id));
        const memoriesIndexedCount = memoriesDiscovered.length - memoriesMissing.length;

        this.setState({
            memories: {
                total: memoriesDiscovered.length,
                indexed: memoriesIndexedCount,
                missing: memoriesMissing.length,
                stale: memoriesStale.length
            }
        });

        // Clean up stale entries from the vector database
        await this.cleanupStaleEntries(vectorService, codeStale, kbStale, memoriesStale);

        // Debug: log sample paths to verify path formats match
        if (codeDiscovered.length > 0 && codeIndexed.size > 0) {
            const sampleDiscovered = toRelativePath(codeDiscovered[0]);
            const sampleIndexed = [...codeIndexed][0];
            console.log(`[IndexOrchestrator] Path format check - discovered (converted): "${sampleDiscovered}", indexed: "${sampleIndexed}"`);
        }

        console.log(`[IndexOrchestrator] Status check:`, {
            code: { total: codeDiscovered.length, indexed: codeIndexedCount, missing: codeMissing.length, stale: codeStale.length },
            kb: { total: kbDiscovered.length, indexed: kbIndexedCount, missing: kbMissing.length, stale: kbStale.length },
            memories: { total: memoriesDiscovered.length, indexed: memoriesIndexedCount, missing: memoriesMissing.length, stale: memoriesStale.length }
        });

        this.emitStatus();
    }

    /**
     * Remove stale entries from the vector database
     */
    private async cleanupStaleEntries(
        vectorService: ReturnType<typeof getVectorService>,
        codeStale: string[],
        kbStale: string[],
        memoriesStale: string[]
    ): Promise<void> {
        // Clean up stale code entries
        if (codeStale.length > 0) {
            console.log(`[IndexOrchestrator] Removing ${codeStale.length} stale code entries...`);
            for (const filePath of codeStale) {
                try {
                    const escapedPath = filePath.replace(/'/g, "''");
                    await vectorService.deleteItems('code', `"filePath" = '${escapedPath}'`);
                } catch (err) {
                    console.error(`[IndexOrchestrator] Failed to delete stale code entry ${filePath}:`, err);
                }
            }
        }

        // Clean up stale KB entries
        if (kbStale.length > 0) {
            console.log(`[IndexOrchestrator] Removing ${kbStale.length} stale KB entries...`);
            const { getKBIndexerService } = await import('../index.js');
            const kbIndexer = getKBIndexerService();
            for (const kbId of kbStale) {
                try {
                    const escapedId = kbId.replace(/'/g, "''");
                    // KB articles are stored with IDs like kb:${kbId}:${chunkIndex}
                    await vectorService.deleteItems('kb', `id LIKE 'kb:${escapedId}:%'`);
                    // Also remove from indexer state
                    if (kbIndexer.state.indexedArticles[kbId]) {
                        const { [kbId]: _, ...rest } = kbIndexer.state.indexedArticles;
                        kbIndexer.setState({ indexedArticles: rest });
                    }
                } catch (err) {
                    console.error(`[IndexOrchestrator] Failed to delete stale KB entry ${kbId}:`, err);
                }
            }
        }

        // Clean up stale memory entries
        if (memoriesStale.length > 0) {
            console.log(`[IndexOrchestrator] Removing ${memoriesStale.length} stale memory entries...`);
            const { getMemoriesIndexerService } = await import('../index.js');
            const memoriesIndexer = getMemoriesIndexerService();
            for (const memoryId of memoriesStale) {
                try {
                    const escapedId = memoryId.replace(/'/g, "''");
                    await vectorService.deleteItems('memories', `id = '${escapedId}'`);
                    // Also remove from indexer state
                    if (memoriesIndexer.state.indexedItems[memoryId]) {
                        const { [memoryId]: _, ...rest } = memoriesIndexer.state.indexedItems;
                        memoriesIndexer.setState({ indexedItems: rest });
                    }
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
        this.rootPath = rootPath;
        if (this.workers.length === 0) await this.init();
        await this.watcher.start(rootPath);
        this.indexedCount = 0;
        this.setState({ status: 'indexing' });
        this.emitStatus();
    }

    async indexAll(force: boolean = false, rootPath?: string) {
        console.log(`[IndexOrchestrator] Re-index requested (force=${force})`);

        // Reload settings to pick up any changes before starting indexing
        this.loadSettings();

        if (rootPath) {
            this.rootPath = rootPath;
        }

        if (!this.rootPath) {
             console.warn('[IndexOrchestrator] Cannot re-index: no root path set');
             return;
        }
        await this.stop();
        // Small delay to ensure resources act free
        await new Promise(resolve => setTimeout(resolve, 500));

        // Initialize/reinitialize workers with the updated settings
        // This also sets up the watcher event handler if not already registered
        await this.init();

        // Start watcher with ignoreInitial: false to trigger discovery logs
        console.log('[IndexOrchestrator] Starting with full scan (ignoreInitial: false)');
        this.rootPath = this.rootPath; // Ensure rootPath is set

        // Reset progress tracking
        this.indexedCount = 0;
        this.setState({ totalFilesDiscovered: 0 });

        // If forcing, reset all indexed counts since the vector tables were purged
        if (force) {
            console.log('[IndexOrchestrator] Force re-index: resetting all indexed counts to 0');
            this.setState({
                code: { total: 0, indexed: 0, missing: 0, stale: 0 },
                kb: { total: 0, indexed: 0, missing: 0, stale: 0 },
                memories: { total: 0, indexed: 0, missing: 0, stale: 0 }
            });
        }

        // Create a promise that resolves when watcher is ready and returns total files
        const watcherReadyPromise = new Promise<number>((resolve) => {
            const onReady = (data?: { totalFiles: number }) => {
                const totalFiles = data?.totalFiles || 0;
                console.log('[IndexOrchestrator] Watcher ready promise resolved with', totalFiles, 'files');
                this.watcher.off('ready', onReady);
                resolve(totalFiles);
            };
            this.watcher.on('ready', onReady);
        });

        // When forcing re-index, use ignoreInitial: false to discover all existing files
        // This makes chokidar emit 'add' events for all files, which get queued for indexing
        const watcherOptions = force ? { ignoreInitial: false } : {};
        await this.watcher.start(this.rootPath, watcherOptions);

        // Wait for watcher to discover files BEFORE setting status
        const totalFiles = await watcherReadyPromise;

        // Update state with discovered file count
        if (totalFiles > 0) {
            this.setState({ totalFilesDiscovered: totalFiles });
            
            // Explicitly initialize VectorService progress with discovered file count
            const vectorService = getVectorService();
            if (vectorService) {
                console.log('[IndexOrchestrator] Initializing VectorService with totalFiles:', totalFiles);
                await vectorService.deferIndexCreation('code');
                vectorService.updateIndexingStatus('code', 0, totalFiles);
            }
        } else {
            console.warn('[IndexOrchestrator] No files discovered, cannot initialize progress');
        }

        this.setState({ status: 'indexing' });
        this.emitStatus();
    }

    async stop() {
        await this.watcher.stop();
        // Terminate workers? Maybe keep them warm.
        this.setState({ status: 'paused' });
        this.emitStatus();
    }

    async stopAll() {
        return this.stop();
    }

    /**
     * Set whether indexing is enabled and emit status
     */
    setIndexingEnabled(enabled: boolean) {
        console.log(`[IndexOrchestrator] Setting indexingEnabled to ${enabled}`);
        this.setState({ indexingEnabled: enabled });
        this.emitStatus();
    }
    
    /**
     * Enhanced stop method for workspace switching
     * Stops all indexing, terminates workers, clears caches, and queues
     * This is called when switching to a new workspace to prevent memory leaks
     */
    async stopAndCleanup(_force = false) {
        console.log('[IndexOrchestrator] Stopping and cleaning up indexing...');
        
        // Stop the watcher first
        await this.watcher.stop();
        
        // Terminate all workers to free up memory
        if (this.workers.length > 0) {
            console.log(`[IndexOrchestrator] Terminating ${this.workers.length} workers...`);
            const terminatePromises = this.workers.map(worker => 
                worker.terminate().catch(err => 
                    console.warn('[IndexOrchestrator] Failed to terminate worker:', err)
                )
            );
            await Promise.all(terminatePromises);
            this.workers = [];
            this.activeWorkers = 0;
        }
        
        // Clear the queue
        const queueLength = (this.queue as any).state.queue.length;
        if (queueLength > 0) {
            console.log(`[IndexOrchestrator] Clearing queue with ${queueLength} items...`);
            this.queue.clear();
        }
        
        // Clear embedding cache to free up memory
        const embeddingService = getEmbeddingService();
        if (embeddingService) {
            const cleared = embeddingService.clearCache();
            console.log(`[IndexOrchestrator] Cleared embedding cache: ${cleared.size} entries, ${cleared.bytesUsed} bytes`);
        }
        
        // Reset indexing progress
        this.indexedCount = 0;
        
        // Set status to idle
        this.setState({ 
            status: 'idle',
            processedCount: 0,
            totalCount: 0,
            totalFilesDiscovered: 0
        });
        this.emitStatus();
        
        console.log('[IndexOrchestrator] Cleanup complete');
    }

  /**
   * Run startup check for indexing
   * This checks for missing items and starts indexing if enabled
   * Note: The file watcher should already be started separately
   */
  async runStartupCheck(rootPath: string = '') {
    if (!rootPath && this.watcher.getState().watchedPath) {
      rootPath = this.watcher.getState().watchedPath || '';
    }
    if (!rootPath) {
      console.log('[IndexOrchestrator] runStartupCheck: No root path available, skipping');
      return;
    }

    console.log(`[IndexOrchestrator] Running startup check for ${rootPath}, indexingEnabled=${this.state.indexingEnabled}`);

    // Check if indexing is enabled FIRST (before expensive checkMissingItems)
    if (!this.state.indexingEnabled) {
      console.log('[IndexOrchestrator] Indexing is disabled in settings, skipping startup check');
      this.setState({ status: 'idle' });
      this.emitStatus();
      return;
    }

    // Check for missing items and update counts
    await this.checkMissingItems(rootPath);
    
    // Queue and index missing items
    const totalMissing = this.state.code.missing + this.state.kb.missing + this.state.memories.missing;
    
    if (totalMissing > 0) {
      console.log(`[IndexOrchestrator] Indexing ${totalMissing} missing items on startup...`);
      
      // Queue missing code files
      if (this.state.code.missing > 0) {
        const { getVectorService } = await import('../index.js');
        const vectorService = getVectorService();
        // Note: indexedFiles contains RELATIVE paths with forward slashes (e.g., "src/foo.ts")
        // discoveredFiles contains ABSOLUTE paths (e.g., "C:\Users\...\src\foo.ts")
        const indexedFiles = await vectorService.getIndexedFilePaths('code');
        const discoveredFiles = await this.discoverWorkspaceFiles(rootPath);

        // Convert absolute paths to relative paths for comparison
        const toRelativePath = (absolutePath: string) => {
            return path.relative(rootPath, absolutePath).replace(/\\/g, '/');
        };

        // Create lowercase Set for case-insensitive comparison (Windows paths are case-insensitive)
        const indexedFilesLower = new Set([...indexedFiles].map(p => p.toLowerCase()));

        const missingFiles = discoveredFiles.filter(absolutePath => {
            const relativePath = toRelativePath(absolutePath);
            return !indexedFilesLower.has(relativePath.toLowerCase());
        });

        const events = missingFiles.map(filePath => ({
          type: 'add' as const,
          path: filePath,  // Keep absolute path for processing
          timestamp: Date.now()
        }));
        this.queue.push(events);
      }
      
      // Trigger KB indexer for missing articles
      if (this.state.kb.missing > 0) {
        console.log(`[IndexOrchestrator] Triggering KB indexer for ${this.state.kb.missing} missing articles`);
        const { getKBIndexerService } = await import('../index.js');
        // Don't await - let it run in parallel with code indexing
        getKBIndexerService().indexWorkspace(rootPath, false).catch(err => {
          console.error('[IndexOrchestrator] KB indexer error:', err);
        });
      }

      // Trigger memories indexer for missing memories
      if (this.state.memories.missing > 0) {
        console.log(`[IndexOrchestrator] Triggering memories indexer for ${this.state.memories.missing} missing memories`);
        const { getMemoriesIndexerService } = await import('../index.js');
        // Don't await - let it run in parallel with code indexing
        getMemoriesIndexerService().indexWorkspace(rootPath, false).catch(err => {
          console.error('[IndexOrchestrator] Memories indexer error:', err);
        });
      }
      
      // Set status to indexing and process queue
      this.setState({ status: 'indexing' });
      this.processQueue();
    } else {
      console.log('[IndexOrchestrator] All items already indexed. Indexing up to date.');
      this.setState({ status: 'idle' });
    }
    
    this.emitStatus();
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

    get isProcessing(): boolean {
        return (this.queue as any).getQueueLength() > 0 || this.activeWorkers > 0;
    }

    private async processQueue() {
        if (this.state.status === 'paused') return;

        // Simple loop: while we have free workers and items in queue
        while (this.activeWorkers < this.maxWorkers && (this.queue as any).state.queue.length > 0) {
            const items = this.queue.pop(1);
            if (items.length === 0) break;
            
            const item = items[0];
            this.activeWorkers++;
            
            // Run in background (fire and forget from loop perspective, but tracked)
            this.processItem(item).finally(() => {
                this.activeWorkers--;
                this.processQueue(); // Trigger next
                this.emitStatus();
                
                // Check if indexing is complete
                if (this.activeWorkers === 0 && (this.queue as any).getQueueLength() === 0 && this.state.status === 'indexing') {
                    this.onIndexingComplete();
                }
            });
        }
        this.emitStatus();
    }

    private async onIndexingComplete() {
        console.log('[IndexOrchestrator] Indexing complete. Creating ANN indexes...');
        const vectorService = getVectorService();
        if (vectorService) {
            try {
                await vectorService.finishDeferredIndexing('code');
                console.log('[IndexOrchestrator] Indexes created successfully');
            } catch (err) {
                console.error('[IndexOrchestrator] Failed to create indexes:', err);
            }
        }
        
        // Final cache clear
        const embeddingService = getEmbeddingService();
        if (embeddingService) {
            embeddingService.clearCache();
        }
        
        this.setState({ status: 'idle' });
        this.emitStatus();
    }

    private async processItem(item: IndexingEvent) {
        const vectorService = getVectorService();
        if (!vectorService) return;

        if (item.type === 'unlink') {
            try {
                // Convert absolute path to relative path (matching what's stored in the vector DB)
                // The watcher sends absolute paths, but the DB stores relative paths with forward slashes
                const relativePath = this.rootPath
                    ? path.relative(this.rootPath, item.path).replace(/\\/g, '/')
                    : item.path;
                const escapedPath = relativePath.replace(/'/g, "''");
                // Use quoted identifiers to match the schema ("filePath")
                await vectorService.deleteItems('code', `"filePath" = '${escapedPath}'`);
                console.log(`[IndexOrchestrator] Deleted index entry for: ${relativePath}`);
            } catch (err) {
                console.error(`[IndexOrchestrator] Failed to delete ${item.path}:`, err);
            }
            return;
        }

        try {
            // Pick a worker (Round Robin or Random)
            const workerIndex = this.reqId % this.workers.length;
            const worker = this.workers[workerIndex];
            const id = (this.reqId++).toString();

            const resultPromise = new Promise<any>((resolve, reject) => {
                this.workerRequestMap.set(id, { resolve, reject });
                // Timeout safety
                setTimeout(() => {
                    if (this.workerRequestMap.has(id)) {
                        this.workerRequestMap.delete(id);
                        reject(new Error('Parser timeout'));
                    }
                }, 30000); 
            });

            // Determine workspace root? Watcher knows it.
            // For now assume item.path is absolute.
            // We need workspace root for relative paths.
            // The WatcherService state has it.
            const workspaceRoot = this.watcher.getState().watchedPath || path.dirname(item.path);

            worker.postMessage({ 
                type: 'parse', 
                id, 
                filePath: item.path, 
                workspaceRoot 
            });

            const result = await resultPromise;
            
            if (result.skipped) {
                // Log skip
                return;
            }

            if (result.chunks && result.chunks.length > 0) {
                 // Push to VectorService
                 if (vectorService) {
                     // First, delete existing entries for this file to avoid stale chunks
                     const escapedPath = item.path.replace(/'/g, "''");
                     // Use quoted identifiers to match the schema ("filePath")
                     await vectorService.deleteItems('code', `"filePath" = '${escapedPath}'`);

                     // Batch upsert to avoid flooding embedding service and OOM
                     const BATCH_SIZE = 10;
                     let totalUpserted = 0;
                     for (let i = 0; i < result.chunks.length; i += BATCH_SIZE) {
                         const batch = result.chunks.slice(i, i + BATCH_SIZE);
                         try {
                             await vectorService.upsertItems(batch, 'code');
                             totalUpserted += batch.length;
                         } catch (err) {
                             console.error(`[IndexOrchestrator] Failed to upsert batch for ${item.path}:`, err);
                             // Continue with next batch? Or fail file?
                             // Fail file is safer for consistency, but partial success might be better.
                         }
                     }

                     console.log(`[IndexOrchestrator] Processed ${item.path}: ${result.chunks.length} chunks, ${totalUpserted} upserted`);

                     // Update progress after successfully processing a file
                     this.indexedCount++;

                     // Update the state counts to reflect progress
                     // For 'add' events: we incremented total+missing on receive, now increment indexed and decrement missing
                     // For 'change' events: we only decremented indexed on receive, now just increment indexed back
                     const newCodeIndexed = this.state.code.indexed + 1;
                     // Only decrement missing for 'add' events (new files), not for 'change' events (re-indexing)
                     const newCodeMissing = item.type === 'add'
                         ? Math.max(0, this.state.code.missing - 1)
                         : this.state.code.missing;
                     this.setState({
                         code: {
                             ...this.state.code,
                             indexed: newCodeIndexed,
                             missing: newCodeMissing
                         }
                     });

                     // Update VectorService with the same counts for consistency
                     vectorService.updateIndexingStatus('code', newCodeIndexed, this.state.code.total);
                     console.log(`[IndexOrchestrator] Progress: ${newCodeIndexed}/${this.state.code.total} files indexed (${newCodeMissing} remaining)`);
                     
                     // Periodically clear embedding cache to prevent memory buildup
                     // Clear every 50 files processed
                     if (this.indexedCount % 50 === 0) {
                         const embeddingService = getEmbeddingService();
                         if (embeddingService) {
                             /* const before = */ embeddingService.clearCache();
                             // Also log memory usage
                             const mem = process.memoryUsage();
                             console.log(`[IndexOrchestrator] Memory: heapUsed=${(mem.heapUsed / 1024 / 1024).toFixed(2)}MB, heapTotal=${(mem.heapTotal / 1024 / 1024).toFixed(2)}MB, external=${(mem.external / 1024 / 1024).toFixed(2)}MB`);
                         }
                     }
                 }
            } else {
                console.log(`[IndexOrchestrator] No chunks for ${item.path} (skipped or empty result)`);
            }

        } catch (error) {
            console.error(`[IndexOrchestrator] Failed to process ${item.path}:`, error);
        }
    }
}
