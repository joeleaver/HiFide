const { spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: !!opts.shell })
  if (r.status !== 0) {
    process.exit(r.status || 1)
  }
}
function tryRun(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: !!opts.shell })
  return r.status === 0
}

try {
  // Ensure native deps match the local Electron version on ALL platforms (best-effort)
  const cliJs = path.join('node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
  const ok = fs.existsSync(cliJs)
    ? tryRun(process.execPath, [cliJs, 'install-app-deps'])
    : tryRun('electron-builder', ['install-app-deps'], { shell: process.platform === 'win32' })
  if (!ok) {
    console.warn('[postinstall] electron-builder install-app-deps failed; continuing. PTY/native deps may need manual rebuild.')
  }

  // Always verify @ast-grep/napi usability (hard fail per requirements)
  run(process.execPath, [path.join('scripts', 'verify-astgrep.cjs')])
  process.exit(0)
} catch (e) {
  console.error('[postinstall] Failed:', e && e.message)
  process.exit(1)
}

