#!/usr/bin/env node
/**
 * Cross-platform electron-builder pack script.
 * - Computes timestamped output dir: release/<version>-<yyyyMMdd-HHmmss>
 * - Invokes electron-builder CLI without PowerShell dependency
 */

const { spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

function tsStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const yyyy = date.getFullYear()
  const MM = pad(date.getMonth() + 1)
  const dd = pad(date.getDate())
  const HH = pad(date.getHours())
  const mm = pad(date.getMinutes())
  const ss = pad(date.getSeconds())
  return `${yyyy}${MM}${dd}-${HH}${mm}${ss}`
}

function buildEnv() {
  const env = { ...process.env }
  // Workaround: some tools read npm_* vars and try to exec pnpm.cjs directly on Windows
  if (process.platform === 'win32') {
    try {
      const pnpmCmd = spawnSync('where.exe', ['pnpm'], { encoding: 'utf8' })
        .stdout.split('\r\n')
        .find(l => l.trim().endsWith('.cmd'))
      if (pnpmCmd) {
        env.npm_execpath = pnpmCmd.trim()
      }
    } catch {
      // Fallback or ignore if where.exe fails
    }
  }
  return env
}

function runNode(cliJs, args) {
  const r = spawnSync(process.execPath, [cliJs, ...args], { stdio: 'inherit', env: buildEnv() })
  return r.status ?? 1
}

function runBin(bin, args, shell) {
  const r = spawnSync(bin, args, { stdio: 'inherit', shell: !!shell, env: buildEnv() })
  return r.status ?? 1
}

try {
  const version = process.env.npm_package_version || '0.0.0'
  const outDir = path.join('release', `${version}-${tsStamp()}`)

  // Prefer direct CLI path for reliability across shells
  const cliJs = path.join('node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
  const args = [
    `--config.directories.output=${outDir}`
  ]

  let code = 1
  if (fs.existsSync(cliJs)) {
    code = runNode(cliJs, args)
  } else {
    // Fallback to PATH-resolved electron-builder
    const isWin = process.platform === 'win32'
    code = runBin('electron-builder', args, isWin)
  }

  process.exit(code)
} catch (e) {
  console.error('[package-electron] Failed:', e && e.message)
  process.exit(1)
}

