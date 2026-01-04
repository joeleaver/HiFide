import { parentPort } from 'node:worker_threads';
import pkg from 'globby';
const globby = pkg.globby || pkg;
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import path from 'node:path';
import fs from 'node:fs';
import ignore from 'ignore';

const DEFAULT_EXCLUDES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.hifide-private/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/target/**',
  '**/out/**',
  '**/.cache/**',
  '**/*.exe',
  '**/*.dll',
  '**/*.so',
  '**/*.dylib',
  '**/*.bin',
  '**/*.png',
  '**/*.jpg',
  '**/*.jpeg',
  '**/*.gif',
  '**/*.svg',
  '**/*.ico',
  '**/*.woff',
  '**/*.woff2',
  '**/*.ttf',
  '**/*.eot'
];

async function discoverWorkspaceFiles(workspaceRoot) {
  console.log(`[discovery-worker] Entering discoverWorkspaceFiles for: ${workspaceRoot}`);
  if (!workspaceRoot) {
    throw new Error('Workspace root is required');
  }

  const ig = ignore();
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  
  if (fs.existsSync(gitignorePath)) {
    try {
      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
      ig.add(gitignoreContent);
    } catch (e) {
      console.warn('[discovery-worker] Failed to read .gitignore:', e);
    }
  }

  console.log(`[discovery-worker] Initializing globby for: ${workspaceRoot}`);
  let files;
  try {
    // Check if globby is actually a function (common ESM/CJS issue)
    if (typeof globby !== 'function') {
        console.error('[discovery-worker] globby is not a function!', typeof globby);
        // Fallback or more diagnostic info
        const globbyPkg = require('globby');
        console.log('[discovery-worker] require("globby") keys:', Object.keys(globbyPkg));
        throw new Error('globby import failed to provide a function');
    }

    files = await globby('**/*', {
      cwd: workspaceRoot,
      ignore: DEFAULT_EXCLUDES,
      absolute: true,
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: false
    });
    console.log(`[discovery-worker] Globby returned ${files?.length} files raw`);
    files.forEach(f => console.log(`[discovery-worker] Discovered file: ${f}`));
  } catch (err) {
    console.error(`[discovery-worker] Globby failed:`, err);
    throw err;
  }

  const filtered = files.filter(file => {
    const relativePath = path.relative(workspaceRoot, file).replace(/\\/g, '/');
    // Ensure we don't return an empty string for the root itself, though globby should handle it
    if (!relativePath) return false;
    return !ig.ignores(relativePath);
  });

  console.log(`[discovery-worker] Found ${files.length} files total, ${filtered.length} after .gitignore`);
  return filtered;
}

parentPort.on('message', async (data) => {
  const { action, workspaceRoot, taskId } = data;

  if (action === 'discover') {
    try {
      console.log(`[discovery-worker] Starting discovery for: ${workspaceRoot}`);
      const files = await discoverWorkspaceFiles(workspaceRoot);
      console.log(`[discovery-worker] Discovery complete. Sending ${files.length} files.`);
      parentPort.postMessage({ action: 'discovery-complete', files, taskId });
    } catch (err) {
      parentPort.postMessage({ 
        action: 'error', 
        taskId,
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack,
          code: err.code
        } 
      });
    }
  }
});