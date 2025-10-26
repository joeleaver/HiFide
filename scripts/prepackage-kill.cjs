#!/usr/bin/env node
/* Cross-platform prepackage killer
 * - On Windows: stop lingering HiFide/electron processes via PowerShell
 * - On non-Windows: no-op (we don't need this during Linux/mac builds)
 */

const { spawnSync } = require('node:child_process')

if (process.platform !== 'win32') {
  process.exit(0)
}

const cmd = [
  'try{Get-Process HiFide -ErrorAction SilentlyContinue|Stop-Process -Force}catch{};',
  'try{Get-Process electron -ErrorAction SilentlyContinue|Stop-Process -Force}catch{};',
  'Start-Sleep -Milliseconds 300'
].join(' ')

const ps = spawnSync('powershell.exe', ['-NoProfile', '-Command', cmd], { stdio: 'inherit' })
// Exit 0 even if processes weren\'t found; treat as best-effort cleanup
process.exit(ps.status == null ? 0 : ps.status)

