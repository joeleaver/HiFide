#!/usr/bin/env node
/**
 * Complete refactoring helper: copies agentTools block from legacy electron/main.ts
 * into electron/main-new.ts placeholder, then writes the result to electron/main.ts
 * (backing up the original).
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

async function run() {
  const root = process.cwd();
  const oldMainPath = path.join(root, 'electron', 'main.ts');
  const newMainPath = path.join(root, 'electron', 'main-new.ts');
  const backupOldPath = path.join(root, 'electron', 'main.legacy.backup.ts');
  const backupNewPath = path.join(root, 'electron', 'main-new.backup.ts');

  function exists(p) { try { fs.accessSync(p); return true } catch { return false } }

  if (!exists(oldMainPath)) throw new Error('electron/main.ts not found');
  if (!exists(newMainPath)) throw new Error('electron/main-new.ts not found');

  const oldMain = await fsp.readFile(oldMainPath, 'utf-8');
  const newMain = await fsp.readFile(newMainPath, 'utf-8');

  // Extract agentTools block from old main
  const oldMatch = oldMain.match(/const\s+agentTools\s*:\s*AgentTool\[\]\s*=\s*\[(?:[\s\S]*?)\n\];/m);
  if (!oldMatch) throw new Error('Could not find agentTools array in old main.ts');
  const agentToolsBlock = oldMatch[0];

  // Replace placeholder agentTools block in new main
  const newMatch = newMain.match(/const\s+agentTools\s*:\s*AgentTool\[\]\s*=\s*\[(?:[\s\S]*?)\n\]\s*;?/m);
  if (!newMatch) throw new Error('Could not find agentTools placeholder in main-new.ts');

  const updatedNewMain = newMain.replace(newMatch[0], agentToolsBlock);

  // Back up files
  await fsp.writeFile(backupOldPath, oldMain, 'utf-8');
  await fsp.writeFile(backupNewPath, newMain, 'utf-8');

  // Overwrite electron/main.ts with the updated content
  await fsp.writeFile(oldMainPath, updatedNewMain, 'utf-8');

  console.log('[complete-refactoring] agentTools copied, main.ts updated. Backups saved as:');
  console.log('  -', path.relative(root, backupOldPath));
  console.log('  -', path.relative(root, backupNewPath));
}

run().catch((e) => { console.error('[complete-refactoring] failed:', e?.message || e); process.exit(1) })

