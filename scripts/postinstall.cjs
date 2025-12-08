const { spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')


function tryRun(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: !!opts.shell,
    env: opts.env ? { ...process.env, ...opts.env } : process.env
  })
  return r.status === 0
}


function buildEnv() {
  const env = { ...process.env, ELECTRON_BUILDER_DISABLE_NPM_REBUILD: 'true' }
  if (process.platform === 'win32') {
    if (env.npm_execpath && /pnpm[\\/]bin[\\/]pnpm\.cjs$/i.test(env.npm_execpath)) {
      delete env.npm_execpath
    }
    if (env.npm_config_user_agent && /pnpm/i.test(env.npm_config_user_agent)) {
      env.npm_config_user_agent = 'npm'
    }
  }
  return env
}

try {
  // Ensure native deps match the local Electron version on ALL platforms (best-effort)
  const cliJs = path.join('node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
  const env = buildEnv()
  if (process.platform !== 'win32') {
    const ok = fs.existsSync(cliJs)
      ? tryRun(process.execPath, [cliJs, 'install-app-deps'], { env })
      : tryRun('electron-builder', ['install-app-deps'], { shell: process.platform === 'win32', env })
    if (!ok) {
      console.warn('[postinstall] electron-builder install-app-deps failed; continuing. PTY/native deps may need manual rebuild.')
    }
  } else {
    console.warn('[postinstall] Skipping electron-builder install-app-deps on Windows; native deps are rebuilt during packaging and via scripts/rebuild if needed.')
  }


  process.exit(0)
} catch (e) {
  console.error('[postinstall] Failed:', e && e.message)
  process.exit(1)
}

