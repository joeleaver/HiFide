const path = require('node:path')
const { rebuild } = require('@electron/rebuild')

module.exports = async function beforePack(context) {
  const appDir = context.appDir || (context.packager && context.packager.appDir) || path.resolve(__dirname, '..')
  let electronVersion
  try {
    electronVersion = require('electron/package.json').version
  } catch {
    // Fallbacks in case package.json resolution is odd
    electronVersion = (context.packager && context.packager.info && context.packager.info.electronVersion) || process.env.ELECTRON_VERSION || undefined
  }
  if (!electronVersion) {
    throw new Error('Could not determine Electron version for @electron/rebuild')
  }
  console.log('[beforePack] Rebuilding native module node-pty for Electron', electronVersion, 'in', appDir)
  await rebuild({
    buildPath: appDir,
    electronVersion,
    force: true,
    onlyModules: ['node-pty']
  })
  console.log('[beforePack] node-pty rebuild complete')
}

