const path = require('node:path')
const fs = require('node:fs')

module.exports = async function afterPack(context) {
  try {
    const resDir = path.join(context.appOutDir, 'resources')
    const unpackedDir = path.join(resDir, 'app.asar.unpacked')
    const ptyDir = path.join(unpackedDir, 'node_modules', 'node-pty')

    const rel = (...xs) => path.join(ptyDir, 'build', 'Release', ...xs)
    const exists = (p) => fs.existsSync(p)
    const isWin = process.platform === 'win32'
    const isMac = process.platform === 'darwin'
    const isLinux = process.platform === 'linux'

    let ok = false
    const missing = []

    if (isWin) {
      const conpty = exists(rel('conpty.node'))
      const winptyPair = exists(rel('winpty.dll')) && exists(rel('winpty-agent.exe'))
      ok = conpty || winptyPair
      if (!ok) {
        missing.push(rel('conpty.node'))
        missing.push(rel('winpty.dll'))
        missing.push(rel('winpty-agent.exe'))
      }
    } else if (isMac || isLinux) {
      ok = exists(rel('pty.node'))
      if (!ok) missing.push(rel('pty.node'))
    } else {
      // Unknown platform: best-effort check for at least one .node
      ok = exists(rel('pty.node')) || exists(rel('conpty.node'))
      if (!ok) missing.push(rel('pty.node'), rel('conpty.node'))
    }

    if (!ok) {
      console.error('[afterPack] Missing PTY binaries in app.asar.unpacked:')
      for (const m of missing) console.error(' -', m)
      throw new Error('PTY binaries missing after pack; failing build to avoid shipping a broken terminal')
    }

    console.log('[afterPack] PTY binaries verified for platform in app.asar.unpacked/node_modules/node-pty/build/Release')
  } catch (e) {
    console.error('[afterPack] PTY verification failed:', e && e.message)
    throw e
  }
}

