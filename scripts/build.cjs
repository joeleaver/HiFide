#!/usr/bin/env node
/**
 * Cross-platform build script.
 * Runs: tsc -> vite build -> rebuild:native -> package:electron
 * Works in PowerShell 5.x, cmd.exe, and bash.
 */

const { spawnSync } = require('node:child_process')
const path = require('node:path')

const isWin = process.platform === 'win32'

function run(cmd, args = [], opts = {}) {
  console.log(`\n[build] Running: ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: isWin,
    ...opts
  })
  if (result.status !== 0) {
    console.error(`[build] Command failed: ${cmd}`)
    process.exit(result.status ?? 1)
  }
  return result
}

// Step 1: TypeScript compile
run('tsc')

// Step 2: Vite build
run('vite', ['build'])

// Step 3: Rebuild native modules
run('pnpm', ['-s', 'rebuild:native'])

// Step 4: Package electron
run('pnpm', ['-s', 'package:electron'])

console.log('\n[build] Build completed successfully!')
