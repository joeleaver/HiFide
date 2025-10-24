const path = require('node:path')
const fs = require('node:fs')

module.exports = async function afterPack(context) {
  try {
    const resDir = path.join(context.appOutDir, 'resources')
    const unpackedDir = path.join(resDir, 'app.asar.unpacked')
    const ptyDir = path.join(unpackedDir, 'node_modules', 'node-pty')

    const req = [
      path.join(ptyDir, 'build', 'Release', 'pty.node'),
      path.join(ptyDir, 'build', 'Release', 'conpty.node'),
      path.join(ptyDir, 'build', 'Release', 'conpty_console_list.node'),
      path.join(ptyDir, 'build', 'Release', 'winpty.dll'),
      path.join(ptyDir, 'build', 'Release', 'winpty-agent.exe')
    ]

    const missing = req.filter((p) => !fs.existsSync(p))

    if (missing.length) {
      console.error('[afterPack] Missing PTY binaries in app.asar.unpacked:')
      for (const m of missing) console.error(' -', m)
      throw new Error('PTY binaries missing after pack; failing build to avoid shipping a broken terminal')
    }

    console.log('[afterPack] PTY binaries verified in app.asar.unpacked/node_modules/node-pty/build/Release')
  } catch (e) {
    console.error('[afterPack] PTY verification failed:', e && e.message)
    throw e
  }
}

