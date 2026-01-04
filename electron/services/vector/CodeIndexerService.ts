import { getVectorService } from '../index.js';
import { Service } from '../base/Service.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface IndexerState {
    indexedFiles: Record<string, string>; // path -> hash
}

export class CodeIndexerService extends Service<IndexerState> {
    private parserWorkers: Worker[] = [];
    private discoveryWorker: Worker | null = null;
    private nextWorkerIndex = 0;
    private initialized = false;
    private pendingTasks = new Map<string, { resolve: (val: any) => void, reject: (err: any) => void }>();

    constructor() {
        super({
            indexedFiles: {}
        }, 'code_indexer');
    }

    async init() {
        if (this.initialized) return;

        try {
            console.log('[CodeIndexerService] Initializing Worker Threads...');
            
            // The service is located in dist-electron/chunks/ (compiled)
            // or electron/services/vector/ (source)
            // We need to find electron/workers/indexing/
            
            const findWorkerDir = () => {
                // Try 1: compiled case - dist-electron/workers/
                const distWorkers = path.resolve(__dirname, '..', 'workers', 'indexing');
                if (fs.existsSync(distWorkers)) return distWorkers;

                // Try 2: source development case - electron/workers/
                // __dirname is electron/services/vector
                const srcWorkers = path.resolve(__dirname, '..', '..', 'workers', 'indexing');
                if (fs.existsSync(srcWorkers)) return srcWorkers;

                // Try 3: absolute fallback based on the error logs provided by user
                // The logs show project root is C:\Users\joe\Documents\hifide
                const absolutePath = 'C:\\Users\\joe\\Documents\\hifide\\electron\\workers\\indexing';
                if (fs.existsSync(absolutePath)) return absolutePath;

                throw new Error(`Could not locate worker directory. Tried: ${distWorkers}, ${srcWorkers}, ${absolutePath}`);
            };

            const workerDir = findWorkerDir();
            const parserWorkerPath = path.join(workerDir, 'parser-worker.js');
            const discoveryWorkerPath = path.join(workerDir, 'discovery-worker.js');

            console.log(`[CodeIndexerService] Resolved Worker Dir: ${workerDir}`);
            
            const numWorkers = Math.max(2, os.cpus().length - 1);
            console.log(`[CodeIndexerService] Initializing ${numWorkers} Parser Workers and 1 Discovery Worker...`);

            for (let i = 0; i < numWorkers; i++) {
                const worker = new Worker(parserWorkerPath);
                this.setupWorkerListeners(worker);
                this.parserWorkers.push(worker);
            }

            this.discoveryWorker = new Worker(discoveryWorkerPath);
            this.setupWorkerListeners(this.discoveryWorker);

            this.initialized = true;
            console.log('[CodeIndexerService] Indexing Workers initialized.');
        } catch (e) {
            console.error(`[CodeIndexerService] Failed to initialize indexing workers:`, e);
            throw e;
        }
    }

    private setupWorkerListeners(worker: Worker) {
        const messageHandler = (message: any) => {
            const task = this.pendingTasks.get(message.taskId);
            if (task) {
                if (message.action === 'error' || message.type === 'error') {
                    task.reject(new Error(message.error?.message || message.error || 'Worker error'));
                } else {
                    task.resolve(message);
                }
                this.pendingTasks.delete(message.taskId);
            }
        };

        const errorHandler = (err: any) => {
            console.error('[CodeIndexerService] Worker error:', err);
        };

        const exitHandler = (code: number) => {
            worker.removeListener('message', messageHandler);
            worker.removeListener('error', errorHandler);
            worker.removeListener('exit', exitHandler);
            
            if (code !== 0) {
                console.error(`[CodeIndexerService] Worker stopped with exit code ${code}`);
                this.initialized = false; // Trigger re-init
            }
        };

        worker.on('message', messageHandler);
        worker.on('error', errorHandler);
        worker.on('exit', exitHandler);
    }

    private runWorkerTask(worker: Worker, action: string, payload: any): Promise<any> {
        const taskId = Math.random().toString(36).substring(7);
        return new Promise((resolve, reject) => {
            this.pendingTasks.set(taskId, { resolve, reject });
            worker.postMessage({ action, taskId, ...payload });
        });
    }

    protected onStateChange(): void {
        this.persistState();
    }

    /**
     * Resets the service, terminates workers, and clears pending tasks.
     */
    reset() {
        if (!this.initialized && this.parserWorkers.length === 0 && !this.discoveryWorker) return;
        
        console.log('[CodeIndexerService] Resetting indexing workers.');
        
        // Reject all pending tasks before clearing
        for (const [taskId, task] of this.pendingTasks.entries()) {
            task.reject(new Error(`Index requester reset workers. Task ${taskId} cancelled.`));
        }
        this.pendingTasks.clear();

        for (const worker of this.parserWorkers) {
            worker.terminate().catch(err => console.error('[CodeIndexerService] Error terminating parser worker:', err));
        }
        this.parserWorkers = [];
        
        if (this.discoveryWorker) {
            this.discoveryWorker.terminate().catch(err => console.error('[CodeIndexerService] Error terminating discovery worker:', err));
            this.discoveryWorker = null;
        }
        
        this.initialized = false;
        this.nextWorkerIndex = 0;
    }

    async indexWorkspace(workspaceRoot: string, force = false) {
        if (!workspaceRoot) return;
        
        // Reject if workspaceRoot is fundamentally different or force requested
        // but avoid aggressive reset if already initialized for the same workspace
        // This prevents the "Assertion failed: !flush_tasks_" native crash 
        // caused by rapid worker termination/creation cycles.
        if (force) {
            this.reset();
        }

        const vectorService = getVectorService();

        // Ensure workers are ready (lazy init)
        await this.init();

        if (force) {
            console.log('[CodeIndexerService] Forced re-index: clearing existing hashes...');
            this.setState({ indexedFiles: {} });
            await this.persistState();
            await vectorService.updateIndexingStatus('code', 0, 0);
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        await vectorService.startTableIndexing('code');

        console.log(`[CodeIndexerService] Starting offloaded discovery in: ${workspaceRoot}`);
        
        const discoveryResult = await this.runWorkerTask(this.discoveryWorker!, 'discover', {
            workspaceRoot
        }).catch(err => {
            console.error('[CodeIndexerService] Discovery task failed:', err);
            throw err;
        });

        if (!discoveryResult || (discoveryResult.action !== 'discovery-complete') || !discoveryResult.files) {
            console.error('[CodeIndexerService] Discovery returned invalid result:', discoveryResult);
            return;
        }

        const files = discoveryResult.files;

        console.log(`[CodeIndexerService] Discovered ${files.length} files to index via worker.`);
        
        vectorService.updateIndexingStatus('code', 0, files.length);

        // Increase concurrency based on worker count
        const concurrency = this.parserWorkers.length * 4; 
        console.log(`[CodeIndexerService] Indexing with concurrency: ${concurrency}`);

        for (let i = 0; i < files.length; i += concurrency) {
            const batch = files.slice(i, i + concurrency);
            
            const results = await Promise.all(batch.map(async (file: string) => {
                return await this.indexFileWithWorker(workspaceRoot, file, force);
            }));

            // Batch update state to reduce disk I/O / JSON stringify overhead
            const newIndexedFiles = { ...this.state.indexedFiles };
            let hasChanges = false;

            for (const res of results) {
                if (res && res.relPath && res.hash) {
                    newIndexedFiles[res.relPath] = res.hash;
                    hasChanges = true;
                }
            }

            if (hasChanges) {
                this.setState({ indexedFiles: newIndexedFiles });
            }
            
            const indexedCount = Math.min(i + concurrency, files.length);
            
            if (indexedCount % 50 === 0 || indexedCount === files.length) {
                vectorService.updateIndexingStatus('code', indexedCount, files.length);
            }

            // Yield to main event loop
            await new Promise(resolve => setImmediate(resolve));
        }

        vectorService.updateIndexingStatus('code', files.length, files.length);
    }

    private async indexFileWithWorker(workspaceRoot: string, filePath: string, force = false): Promise<{relPath: string, hash: string} | null> {
        const vectorService = getVectorService();
        try {
            const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
            
            // Pick next worker in round-robin
            const worker = this.parserWorkers[this.nextWorkerIndex];
            this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.parserWorkers.length;

            const response = await this.runWorkerTask(worker, 'process_file', {
                filePath,
                workspaceRoot
            });

            const { hash, chunks, relPath: workerRelPath } = response.result;

            if (!force && this.state.indexedFiles[relPath] === hash) {
                return null;
            }

            if (chunks && chunks.length > 0) {
                await vectorService.upsertItems(chunks, 'code');
            }

            return { relPath: workerRelPath || relPath, hash };
        } catch (error) {
            console.error(`[CodeIndexerService] Failed to index file ${filePath}:`, error);
            return null;
        }
    }
}