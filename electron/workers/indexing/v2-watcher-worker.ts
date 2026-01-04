import { parentPort, workerData } from 'node:worker_threads';
import ignore from 'ignore';
import fs from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';

interface WorkerData {
    rootPath: string;
    options: any;
    debounceMs?: number;
}

const { rootPath, options, debounceMs = 500 } = workerData as WorkerData;

let watcher: FSWatcher | null = null;
let eventBuffer: Array<{ type: string; path: string }> = [];
let debounceTimer: NodeJS.Timeout | null = null;
let gitignore: ReturnType<typeof ignore> | null = null;

// Built-in patterns to always ignore
const IGNORED_PATTERNS = [
    '**/node_modules/**',
    '**/.git/**',
    '**/.hifide/**',
    '**/.hifide-public/**',
    '**/.hifide-private/**',
    '**/dist/**',
    '**/build/**',
    '**/out/**',
    '**/.next/**',
    '**/.cache/**',
    '**/target/**',
    '**/vendor/**'
];

function flushEvents() {
    if (eventBuffer.length === 0) return;
    
    // Log sample of events for debugging (limited to top 5)
    const sampleSize = 5;
    const sampleEvents = eventBuffer.slice(0, sampleSize);
    const eventSummary = sampleEvents.map(e => `${e.type}: ${path.basename(e.path)}`).join(', ');
    const moreCount = eventBuffer.length - sampleSize;
    const moreText = moreCount > 0 ? ` +${moreCount} more` : '';
    console.log(`[Watcher] Processing ${eventBuffer.length} events: ${eventSummary}${moreText}`);
    
    if (parentPort) {
        parentPort.postMessage({ type: 'batch', events: eventBuffer });
    }
    eventBuffer = [];
    debounceTimer = null;
}

function queueEvent(type: string, filePath: string) {
    // Basic dedupe: if we have (change, fileA) and get (change, fileA), ignore.
    // If we have (add, fileA) and get (change, fileA), keep both? Or merge?
    // Let's just push for now, optimization in the Queue component is safer.
    eventBuffer.push({ type, path: filePath });

    if (!debounceTimer) {
        debounceTimer = setTimeout(flushEvents, debounceMs);
    }
}

async function loadGitignore() {
    try {
        const gitignorePath = path.join(rootPath, '.gitignore');
        const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8').catch(() => '');
        
        if (gitignoreContent) {
            gitignore = ignore().add(gitignoreContent);
            console.log('[Watcher] Loaded .gitignore from workspace root');
        } else {
            console.log('[Watcher] No .gitignore found at workspace root');
        }
    } catch (error) {
        console.warn('[Watcher] Failed to load .gitignore:', error);
    }
}

async function startWatcher() {
    try {
        // Load .gitignore before starting watcher
        await loadGitignore();
        
        let foundCount = 0;
        
        // Configure chokidar to filter files using both built-in patterns and .gitignore
        // Track samples of ignored files for logging
const ignoredSamples: string[] = [];
const MAX_IGNORED_SAMPLES = 5;

const watchOptions = {
    ignored: (filePath: string) => {
        // Skip empty paths (chokidar sometimes passes them)
        if (!filePath || filePath.length === 0) {
            console.log('[Watcher] Skipping empty path');
            return true;
        }
        
        // Check against built-in patterns first
        const isBuiltInIgnored = IGNORED_PATTERNS.some(pattern => {
            // Convert glob pattern to regex-like check
            const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
            return regex.test(filePath);
        });
        
        if (isBuiltInIgnored) {
            logIgnoredSample(filePath, 'built-in pattern');
            return true;
        }
        
        // Check against .gitignore if loaded
        if (gitignore) {
            const relativePath = path.relative(rootPath, filePath).replace(/\\/g, '/');
            // Empty relative path means it's the root path - don't ignore it
            if (!relativePath || relativePath.length === 0) {
                console.log('[Watcher] Root path detected, not ignoring:', filePath);
                return false;
            }
            const isIgnored = gitignore.ignores(relativePath);
            if (isIgnored) {
                logIgnoredSample(filePath, 'gitignore');
            }
            return isIgnored;
        }
        
        // Check additional user-provided patterns
        if (options.ignored && Array.isArray(options.ignored)) {
            const isUserIgnored = options.ignored.some((pattern: string) => {
                const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
                return regex.test(filePath);
            });
            if (isUserIgnored) {
                logIgnoredSample(filePath, 'user pattern');
            }
            return isUserIgnored;
        }
        
        return false;
    },
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100
    },
    ...options
};

function logIgnoredSample(filePath: string, reason: string) {
    if (ignoredSamples.length < MAX_IGNORED_SAMPLES) {
        const relPath = path.relative(rootPath, filePath);
        ignoredSamples.push(`${relPath} (${reason})`);
    }
} 
        console.log('[Watcher] Starting with gitignore filtering:', {
            rootPath,
            hasGitignore: !!gitignore,
            builtInPatterns: IGNORED_PATTERNS.length
        });
        
        watcher = chokidar.watch(rootPath, watchOptions);

        watcher
            .on('add', path => {
                if (!watcher?.options?.ignoreInitial) {
                    foundCount++;
                    if (foundCount % 10 === 0) {
                        parentPort?.postMessage({ type: 'log', message: `Scanning... ${foundCount} files found` });
                    }
                }
                queueEvent('add', path);
            })
            .on('change', path => queueEvent('change', path))
            .on('unlink', path => queueEvent('unlink', path))
            .on('error', error => {
                if (parentPort) parentPort.postMessage({ type: 'error', error: (error as any).message });
            })
            .on('ready', () => {
                if (parentPort) {
                    // Log total discovered files
                    if (!watcher?.options?.ignoreInitial) {
                        parentPort.postMessage({ type: 'log', message: `Discovery complete. Total files: ${foundCount}` });
                    }
                    // Log sample of ignored files
                    if (ignoredSamples.length > 0) {
                        parentPort.postMessage({ 
                            type: 'log', 
                            message: `Sample of ${MAX_IGNORED_SAMPLES} ignored files: ${ignoredSamples.join(', ')}` 
                        });
                    }
                    // Send total discovered files count for progress tracking
                    parentPort.postMessage({ type: 'ready', totalFiles: foundCount });
                }
            });

        if (parentPort) {
            parentPort.on('message', (msg) => {
                if (msg === 'stop') {
                    if (watcher) watcher.close();
                    process.exit(0);
                }
            });
        }
    } catch (error) {
        if (parentPort) parentPort.postMessage({ type: 'error', error: String(error) });
    }
}

// Start the watcher immediately
startWatcher();
