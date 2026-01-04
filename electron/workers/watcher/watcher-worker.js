const { parentPort, workerData } = require('worker_threads');
const chokidar = require('chokidar');
const path = require('path');

const { rootPath, options } = workerData;

console.log(`[WatcherWorker] Starting watch on: ${rootPath}`);

const watcher = chokidar.watch(rootPath, {
  ignored: [
    '**/node_modules/**',
    '**/.git/**',
    '**/.hifide/**',
    '**/.hifide-public/**',
    ...(options.ignored || [])
  ],
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 1000,
    pollInterval: 100
  },
  ...options
});

watcher
  .on('add', path => parentPort.postMessage({ type: 'add', path }))
  .on('change', path => parentPort.postMessage({ type: 'change', path }))
  .on('unlink', path => parentPort.postMessage({ type: 'unlink', path }))
  .on('error', error => parentPort.postMessage({ type: 'error', error: error.message }))
  .on('ready', () => parentPort.postMessage({ type: 'ready' }));

parentPort.on('message', (msg) => {
  if (msg === 'stop') {
    watcher.close();
    process.exit(0);
  }
});
