import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// import { createRequire } from 'node:module';
import fs from 'node:fs';
import { Service } from '../base/Service.js';
import { WatcherOptions, IndexingEvent } from './types.js';

interface WatcherState {
    status: 'stopped' | 'starting' | 'ready' | 'error';
    error: string | null;
    watchedPath: string | null;
}

export class WatcherService extends Service<WatcherState> {
    private worker: Worker | null = null;
    
    constructor() {
        super({
            status: 'stopped',
            error: null,
            watchedPath: null
        }, 'watcher_service');
    }

    protected onStateChange(_updates: Partial<WatcherState>, _prevState: WatcherState): void {
        // Persist only watchedPath if needed, but status is transient.
        // For now, no specific persistence logic needed beyond base class.
    }

    private getWorkerPath(): string {
        // Logic to find the worker file
        let baseDir = '';
        try {
            baseDir = path.dirname(fileURLToPath(import.meta.url));
        } catch {
            baseDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
        }

        const candidates = [
            path.join(process.cwd(), 'dist-electron/workers/indexing/v2-watcher-worker.mjs'), // Vite build (Dev & Prod)
            path.join(baseDir, '../../workers/indexing/v2-watcher-worker.js'), // compiled relative to services/indexing/
            path.join(baseDir, '../../workers/indexing/v2-watcher-worker.ts'), // dev (ts-node)
            path.join(process.cwd(), 'dist-electron/workers/indexing/v2-watcher-worker.js'), // prod bundle (legacy)
            path.join(process.cwd(), 'electron/workers/indexing/v2-watcher-worker.ts'), // dev source
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) return candidate;
        }

        throw new Error('Could not find v2-watcher-worker');
    }

    async start(rootPath: string, options: WatcherOptions = {}) {
        if (this.worker) await this.stop();

        this.setState({ status: 'starting', watchedPath: rootPath, error: null });

        try {
            const workerPath = this.getWorkerPath();
            console.log('[WatcherService] Starting worker from:', workerPath);

            let execArgv: string[] | undefined = undefined;
            if (workerPath.endsWith('.ts')) {
                // Use absolute path for ts-node to avoid resolution issues in Electron environment
                console.log('WatcherService CWD:', process.cwd());
      const tsNodePath = path.join(process.cwd(), 'node_modules', 'ts-node', 'register.js');
                execArgv = ['-r', tsNodePath];
            }
            
            this.worker = new Worker(workerPath, {
                workerData: {
                    rootPath,
                    options,
                    debounceMs: options.debounceMs ?? 500
                },
                execArgv
            });

            this.worker.on('message', (msg) => {
                if (msg.type === 'log') {
                    if (msg.text) {
                        console.log(`[WatcherService] ${msg.text}`);
                    }
                } else if (msg.type === 'ready') {
                    this.setState({ status: 'ready' });
                    this.emit('ready', { totalFiles: msg.totalFiles });
                } else if (msg.type === 'error') {
                    this.setState({ status: 'error', error: msg.error });
                    console.error('[WatcherService] Worker error:', msg.error);
                } else if (msg.type === 'batch') {
                    const events: IndexingEvent[] = msg.events.map((e: any) => ({
                        ...e,
                        timestamp: Date.now()
                    }));
                    this.emit('events', events);
                } else if (msg.type === 'ready') {
                    // Pass total discovered files count along with ready event
                    this.emit('ready', msg.totalFiles);
                }
            });

            this.worker.on('error', (err) => {
                this.setState({ status: 'error', error: (err as any).message });
                console.error('[WatcherService] Worker thread error:', err);
            });

            this.worker.on('exit', (code) => {
                if (code !== 0) {
                    this.setState({ status: 'error', error: `Worker exited with code ${code}` });
                    console.error(`[WatcherService] Worker exited with code ${code}`);
                } else {
                    this.setState({ status: 'stopped' });
                }
            });

        } catch (error) {
            this.setState({ status: 'error', error: String(error) });
            console.error('[WatcherService] Failed to start:', error);
        }
    }

    async stop() {
        if (this.worker) {
            this.worker.postMessage('stop');
            await this.worker.terminate();
            this.worker = null;
        }
        this.setState({ status: 'stopped', watchedPath: null });
    }
}
