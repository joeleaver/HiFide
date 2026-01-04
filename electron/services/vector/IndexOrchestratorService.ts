import { Service } from '../base/Service.js';
import { 
  getCodeIndexerService, 
  getKBIndexerService, 
  getMemoriesIndexerService, 
  getVectorService,
  getWorkspaceService 
} from '../index.js';
import * as chokidar from 'chokidar';
import path from 'node:path';

interface IndexJob {
  type: 'code' | 'kb' | 'memories';
  action: 'index_file' | 'index_article' | 'delete';
  workspaceRoot: string;
  filePathOrId: string;
  force?: boolean;
}

interface OrchestratorState {
  lastFullIndex?: number;
  isWatching: boolean;
  queueLength: number;
  isProcessing: boolean;
  currentTask?: string;
}

export class IndexOrchestratorService extends Service<OrchestratorState> {
  onStateChange(_updates: Partial<OrchestratorState>): void {}

  private watcher: any | null = null;
  private watcherWorker: any | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private jobQueue: IndexJob[] = [];

  constructor() {
    super({
      isWatching: false,
      queueLength: 0,
      isProcessing: false
    }, 'index_orchestrator');
  }

  /**
   * Clears any pending jobs and stops active workers/watchers.
   * Used when switching workspaces to ensure old indexing tasks don't leak.
   */
  async stopAll() {
    console.log('[IndexOrchestrator] Stopping all background tasks and clearing queue.');
    
    // 1. Clear the job queue
    this.jobQueue = [];
    
    // 2. Clear any pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // 3. Stop the file watcher
    this.stopWatching();

    // 4. Reset indexer workers (via indexer services)
    const { getCodeIndexerService, getKBIndexerService } = await import('../index.js');
    getCodeIndexerService().reset();
    getKBIndexerService().reset();

    this.setState({ 
      isProcessing: false, 
      queueLength: 0,
      currentTask: undefined 
    });
  }

  async indexAll(force = false) {
    const workspace = getWorkspaceService().getActiveWorkspaceRoot();
    if (!workspace) return;

    // Ensure we are clean before starting new work
    await this.stopAll();

    console.log(`[IndexOrchestrator] Queuing full indexing for ${workspace}`);
    
    // We don't await the full indexing here to keep it non-blocking
    this.queueFullIndex(workspace, force);
    
    this.startWatching(workspace);
  }

  async runStartupCheck() {
    const { getWorkspaceService } = await import('../../services/index.js');
    const workspace = getWorkspaceService().getActiveWorkspaceRoot();
    if (!workspace) return;

    // Use a background task to check stats and run indexing
    (async () => {
      try {
        console.log('[IndexOrchestrator] Starting background index validation...');
        const { getVectorService } = await import('../../services/index.js');
        const vs = getVectorService();
        
        // Initial health check of the tables
        const stats = await vs.refreshTableStats() as any;

        const hasCode = stats?.tables?.code?.exists && stats?.tables?.code?.count > 0;
        const hasKB = stats?.tables?.kb?.exists && stats?.tables?.kb?.count > 0;

        if (!hasCode || !hasKB) {
          console.log(`[IndexOrchestrator] Missing or empty indexes detected (Code: ${!!hasCode}, KB: ${!!hasKB}). Starting full background indexing.`);
          await this.indexAll();
        } else {
          console.log(`[IndexOrchestrator] Indexes verified: Code(${stats?.tables?.code?.count}), KB(${stats?.tables?.kb?.count})`);
          // Even if indexes exist, we still need to start watching for changes
          this.startWatching(workspace);
        }
      } catch (err) {
        console.error('[IndexOrchestrator] Background startup check failed:', err);
      }
    })();

    // Always proceed and report system as ready immediately
    console.log('[IndexOrchestrator] System proceeding to ready state.');
  }

  private async queueFullIndex(workspace: string, force: boolean) {
    // Instead of one giant job, we let the indexers themselves report progress
    // but we wrap them in the non-blocking processor.
    
    // First, Code
    this.enqueue({
        type: 'code',
        action: 'index_file', // Special case handled in processor
        workspaceRoot: workspace,
        filePathOrId: '__FULL_INDEX__',
        force
    });

    // Then KB
    this.enqueue({
        type: 'kb',
        action: 'index_article',
        workspaceRoot: workspace,
        filePathOrId: '__FULL_INDEX__',
        force
    });

    // Then Memories
    this.enqueue({
        type: 'memories',
        action: 'index_file',
        workspaceRoot: workspace,
        filePathOrId: '__FULL_INDEX__',
        force
    });
  }

  private enqueue(job: IndexJob) {
    this.jobQueue.push(job);
    this.setState({ queueLength: this.jobQueue.length });
    this.processQueue();
  }

  private async processQueue() {
    if (this.state.isProcessing || this.jobQueue.length === 0) return;

    this.setState({ isProcessing: true });

    while (this.jobQueue.length > 0) {
      const job = this.jobQueue.shift()!;
      this.setState({ 
        queueLength: this.jobQueue.length,
        currentTask: `${job.type}:${job.action}:${path.basename(job.filePathOrId)}`
      });

      try {
        // Use setImmediate to ensure that the actual work starts in a new task,
        // allowing the event loop to sweep through any pending UI callbacks.
        await new Promise(resolve => setImmediate(resolve));
        await this.executeJob(job);
      } catch (error: any) {
        console.error(`[IndexOrchestrator] Job failed:`, job, error);
        
        // If we hit a LanceDB IO error during deletion or indexing, the table manifest might be out of sync.
        // We catch it here to prevent the loop from dying, but we should notify the user or log it clearly.
        if (error?.message?.includes('LanceError(IO)') || error?.message?.includes('manifest not found')) {
          console.warn('[IndexOrchestrator] Detected local vector database corruption or version mismatch. A full re-index is recommended.');
        }
      }
      
      this.setState({ queueLength: this.jobQueue.length });
      
      // Deeper yield after each job. 100ms is enough to let Electron Main
      // process Inter-Process Communication (IPC) and heartbeats.
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.setState({ 
        isProcessing: false, 
        currentTask: undefined,
        lastFullIndex: Date.now() 
    });
  }

  private async executeJob(job: IndexJob) {
    const { type, action, workspaceRoot, filePathOrId, force } = job;

    if (action === 'delete') {
        const vs = getVectorService();
        if (type === 'kb') {
            await vs.deleteItems('kb', `kbId = '${filePathOrId}'`);
        } else {
            await vs.deleteItems('code', `"filePath" = '${filePathOrId}'`);
        }
        return;
    }

    if (filePathOrId === '__FULL_INDEX__') {
        if (type === 'code') await getCodeIndexerService().indexWorkspace(workspaceRoot, force);
        if (type === 'kb') await getKBIndexerService().indexWorkspace(workspaceRoot, force);
        if (type === 'memories') await getMemoriesIndexerService().indexWorkspace(workspaceRoot, force);
        return;
    }

    // Incremental jobs
    if (type === 'code') {
        const indexer = getCodeIndexerService();
        if ('indexFile' in indexer && typeof (indexer as any).indexFile === 'function') {
            await (indexer as any).indexFile(workspaceRoot, filePathOrId, force);
        } else {
            // Fallback if indexFile was renamed or moved during worker conversion
            await indexer.indexWorkspace(workspaceRoot, force);
        }
    } else if (type === 'kb') {
        await getKBIndexerService().indexArticle(workspaceRoot, filePathOrId, force);
    } else if (type === 'memories') {
        await getMemoriesIndexerService().indexWorkspace(workspaceRoot);
    }
  }

  startWatching(workspaceRoot: string) {
    if (this.watcherWorker) {
      this.watcherWorker.terminate();
    }

    try {
      const { Worker } = require('node:worker_threads');
      const workerPath = path.resolve(__dirname, '..', '..', 'workers', 'watcher', 'watcher-worker.js');
      
      console.log(`[IndexOrchestrator] Starting off-thread watcher for: ${workspaceRoot}`);
      this.watcherWorker = new Worker(workerPath, {
        workerData: { workspaceRoot }
      });

      this.watcherWorker.on('message', (event: any) => {
        const { type, filePath } = event;
        this.handleFileChange(workspaceRoot, filePath);
      });

      this.watcherWorker.on('error', (err: any) => {
        console.error('[IndexOrchestrator] Watcher worker error:', err);
      });

    } catch (err) {
      console.error('[IndexOrchestrator] Failed to start watcher worker:', err);
    }
  }

  private handleFileChange(workspaceRoot: string, filePath: string) {
    const ext = path.extname(filePath);
    const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');

    if (this.debounceTimers.has(filePath)) {
      clearTimeout(this.debounceTimers.get(filePath)!);
    }

    const timer = setTimeout(() => {
      if (relPath.startsWith('.hifide-public/kb/')) {
        const kbId = path.basename(filePath, '.md');
        this.enqueue({ type: 'kb', action: 'index_article', workspaceRoot, filePathOrId: kbId });
      } else if (relPath.startsWith('.hifide-public/memories/')) {
        this.enqueue({ type: 'memories', action: 'index_file', workspaceRoot, filePathOrId: filePath });
      } else if (['.ts', '.tsx', '.js', '.jsx', '.go', '.rs', '.py', '.c', '.cpp', '.h', '.hpp', '.sh', '.md'].includes(ext)) {
        this.enqueue({ type: 'code', action: 'index_file', workspaceRoot, filePathOrId: filePath });
      }
      this.debounceTimers.delete(filePath);
    }, 2000);

    this.debounceTimers.set(filePath, timer);
  }

  private handleFileDeletion(workspaceRoot: string, filePath: string) {
    const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
    
    if (relPath.startsWith('.hifide-public/kb/')) {
        const kbId = path.basename(filePath, '.md');
        this.enqueue({ type: 'kb', action: 'delete', workspaceRoot, filePathOrId: kbId });
    } else {
        this.enqueue({ type: 'code', action: 'delete', workspaceRoot, filePathOrId: relPath });
    }
  }

  async stopWatching() {
    if (this.watcherWorker) {
      console.log('[IndexOrchestrator] Terminating watcher worker.');
      this.watcherWorker.postMessage('stop');
      this.watcherWorker.terminate();
      this.watcherWorker = null;
    }
  }
}