const { spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

function tryRun(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: !!opts.shell,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    cwd: opts.cwd
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

/**
 * Ensure vscode-ripgrep binary is downloaded.
 * pnpm sometimes doesn't run package postinstall scripts correctly,
 * so we manually trigger the download if the binary is missing.
 */
function ensureRipgrepBinary() {
  try {
    // Find the vscode-ripgrep package location
    const ripgrepPkg = require.resolve('vscode-ripgrep/package.json')
    const ripgrepDir = path.dirname(ripgrepPkg)
    const binDir = path.join(ripgrepDir, 'bin')

    // Check platform-specific binary name
    const binaryName = process.platform === 'win32' ? 'rg.exe' : 'rg'
    const binaryPath = path.join(binDir, binaryName)

    if (fs.existsSync(binaryPath)) {
      console.log('[postinstall] ripgrep binary already exists:', binaryPath)
      return true
    }

    console.log('[postinstall] ripgrep binary missing, running postinstall script...')

    // Run the vscode-ripgrep postinstall script directly
    const postinstallScript = path.join(ripgrepDir, 'lib', 'postinstall.js')
    if (fs.existsSync(postinstallScript)) {
      const ok = tryRun(process.execPath, [postinstallScript], { cwd: ripgrepDir })
      if (ok && fs.existsSync(binaryPath)) {
        console.log('[postinstall] ripgrep binary downloaded successfully')
        return true
      }
    }

    // Alternative: try npm rebuild
    console.log('[postinstall] Trying npm rebuild vscode-ripgrep...')
    const rebuildOk = tryRun('npm', ['rebuild', 'vscode-ripgrep'], { shell: true })
    if (rebuildOk && fs.existsSync(binaryPath)) {
      console.log('[postinstall] ripgrep binary rebuilt successfully')
      return true
    }

    console.warn('[postinstall] Failed to download ripgrep binary. Text search will use Node.js fallback.')
    return false
  } catch (e) {
    console.warn('[postinstall] Error checking ripgrep binary:', e.message)
    return false
  }
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

  // Ensure ripgrep binary is available (pnpm sometimes doesn't run package postinstall scripts)
  ensureRipgrepBinary()

  process.exit(0)
} catch (e) {
  console.error('[postinstall] Failed:', e && e.message)
  process.exit(1)
}
