const { spawnSync } = require('node:child_process')
const path = require('node:path')

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false })
  if (r.status !== 0) {
    process.exit(r.status || 1)
  }
}

try {
  if (process.platform !== 'win32') {
    // On non-Windows, let electron-builder rebuild native deps to match Electron
    run('electron-builder', ['install-app-deps'])
  } else {
    console.log('[postinstall] Skipping electron-builder install-app-deps on Windows due to pnpm runner issue; relying on prebuilt binaries and build.npmRebuild=false')
  }
  // Always verify @ast-grep/napi usability
  run(process.execPath, [path.join('scripts', 'verify-astgrep.cjs')])
  process.exit(0)
} catch (e) {
  console.error('[postinstall] Failed:', e && e.message)
  process.exit(1)
}

