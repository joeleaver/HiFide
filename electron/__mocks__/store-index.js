// Jest mock for '../store/index.js' used by electron/refactors/ts.ts
// Provides a minimal useMainStore API for tests

let __workspaceRoot = process.cwd()

exports.__setWorkspaceRoot = (p) => { __workspaceRoot = p }

const __state = {
  workspaceRoot: __workspaceRoot,
  idxAutoRefresh: {
    enabled: true,
    ttlMinutes: 120,
    minIntervalMinutes: 10,
    changeAbsoluteThreshold: 100,
    changePercentThreshold: 0.02,
    lockfileTrigger: true,
    lockfileGlobs: ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'],
    modelChangeTrigger: true,
    maxRebuildsPerHour: 3,
  },
  idxLastRebuildAt: undefined,
  idxRebuildTimestamps: [],
  idxLastScanAt: undefined,
  idxLastFileCount: undefined,
}

exports.useMainStore = {
  getState: () => ({ ...__state, workspaceRoot: __workspaceRoot }),
  setState: (patch) => {
    if (typeof patch === 'function') {
      const next = patch({ ...__state })
      Object.assign(__state, next || {})
    } else if (patch && typeof patch === 'object') {
      Object.assign(__state, patch)
    }
  }
}

