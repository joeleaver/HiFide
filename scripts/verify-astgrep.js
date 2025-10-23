try {
  const napi = require('@ast-grep/napi')
  if (!(napi && (napi.ts?.parse || typeof napi.parse === 'function'))) {
    throw new Error('ast-grep parse API not found')
  }
  if (napi.ts?.parse) {
    const root = napi.ts.parse('const __ok = 1')
    if (!root) throw new Error('ast-grep ts parser returned null')
  } else {
    const root = napi.parse('ts', 'const __ok = 1')
    if (!root) throw new Error('ast-grep generic parse returned null')
  }
  process.exit(0)
} catch (e) {
  console.error('[verify-astgrep] @ast-grep/napi not usable:', e && e.message)
  process.exit(1)
}

