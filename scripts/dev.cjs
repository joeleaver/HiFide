#!/usr/bin/env node
/**
 * Cross-platform dev script.
 * Cleans dist-electron and starts vite dev server.
 * Works in PowerShell 5.x, cmd.exe, and bash.
 */

const { spawnSync } = require('node:child_process')
const path = require('node:path')

// Step 1: Clean dist-electron
const cleanScript = path.join(__dirname, 'clean-dist-electron.cjs')
const cleanResult = spawnSync(process.execPath, [cleanScript], { stdio: 'inherit' })

if (cleanResult.status !== 0) {
  console.error('[dev] clean-dist-electron failed')
  process.exit(cleanResult.status ?? 1)
}

// Step 2: Start vite
const isWin = process.platform === 'win32'
const viteResult = spawnSync('vite', [], { stdio: 'inherit', shell: isWin })

process.exit(viteResult.status ?? 1)
