import { searchWorkspaceTool } from '../searchWorkspace'
// Ensure services are mocked for auto-refresh preflight
jest.mock('../../../services/base/ServiceRegistry', () => ({
  ServiceRegistry: {
    get: (name: string) => {
      if (name === 'workspace') {
        return {
          getWorkspaceRoot: () => process.cwd(),
        }
      }
      if (name === 'indexing') {
        return {
          getState: () => ({
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
          }),
          setState: jest.fn(),
        }
      }
      return null
    },
  },
}))


// Mock the indexer to avoid heavy rebuilds during tests
jest.mock('../../../core/state', () => {
  const path = require('node:path')
  const mockRebuild = jest.fn().mockResolvedValue(undefined)
  const mockIndexer = {
    status: () => ({ exists: false, ready: false, inProgress: false, indexPath: path.join(process.cwd(), '.hifide-private/indexes/meta.json') }),
    rebuild: mockRebuild,
    search: async () => ({ chunks: [] }),
  }
  return {
    getIndexer: async () => mockIndexer,
    __mock: { mockRebuild }
  }
})

// Use the store mock provided in electron/__mocks__/store-index.js automatically by Jest

describe('workspace.search auto-refresh preflight', () => {
  beforeEach(() => {
    const stateMod = require('../../../core/state')
    stateMod.__mock.mockRebuild.mockClear()
  })

  it('triggers rebuild when index is missing', async () => {
    const res: any = await searchWorkspaceTool.run({ mode: 'text', query: 'just_a_token', filters: { pathsInclude: ['electron/**'], maxResults: 1 } })
    expect(res && res.ok).toBe(true)
    // Rebuild should have been called once by preflight
    const stateMod = require('../../../core/state')
    expect(stateMod.__mock.mockRebuild).toHaveBeenCalled()
  })
})

