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
  const env = { ...process.env }
  // Prevent electron-builder from being confused by pnpm's npm_execpath on Windows
  if (process.platform === 'win32') {
    // If we're using pnpm, ensure we point to the .cmd wrapper, not the .cjs file
    // which Windows can't execute directly.
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

try {
  console.log('[postinstall] Running electron-builder install-app-deps...')
  const env = buildEnv()
  // Try to find electron-builder in node_modules first for speed/reliability
  const cliJs = path.join('node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
  
  let ok = false
  if (fs.existsSync(cliJs)) {
    ok = tryRun(process.execPath, [cliJs, 'install-app-deps'], { env })
  } else {
    ok = tryRun('npx', ['electron-builder', 'install-app-deps'], { shell: true, env })
  }

  if (!ok) {
    console.warn('[postinstall] electron-builder install-app-deps failed. PTY/native deps may need manual rebuild.')
  }

  process.exit(0)
} catch (e) {
  console.error('[postinstall] Failed:', e && e.message)
  process.exit(1)
}
