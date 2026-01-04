
import { applyMemoryCandidates, MemoryCandidate } from '../memories'
import { getVectorService } from '../../services/index'

jest.mock('../../services/index', () => ({
  getVectorService: jest.fn(),
}))

jest.mock('../../utils/workspace.js', () => ({
  resolveWorkspaceRootAsync: jest.fn(async () => '/tmp/workspace'),
}))

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  rename: jest.fn(),
  unlink: jest.fn(),
}))

describe('applyMemoryCandidates semantic search', () => {
  let mockVectorService: any

  beforeEach(() => {
    jest.clearAllMocks()
    mockVectorService = {
      search: jest.fn(),
      init: jest.fn(),
    }
    ;(getVectorService as jest.Mock).mockReturnValue(mockVectorService)
  })

  it('updates an existing memory if semantic similarity is high', async () => {
    const candidates: MemoryCandidate[] = [
      { type: 'decision', text: 'Use LanceDB for vectors', tags: ['db'], importance: 0.8 }
    ]

    // Setup: existing memory in store (mocked via readFile)
    const existingMemory = {
      id: 'mem-1',
      type: 'decision',
      text: 'We decided to use LanceDB to store our vector data',
      tags: ['database'],
      importance: 0.5,
      contentHash: 'hash-1',
      createdAt: '2023-01-01',
      updatedAt: '2023-01-01'
    }

    const fs = require('node:fs/promises')
    fs.readFile.mockResolvedValue(JSON.stringify({ 
      version: 1, 
      items: [existingMemory] 
    }))

    // Mock semantic search hit
    mockVectorService.search.mockResolvedValue([
      { id: 'mem-1', score: 0.9, text: existingMemory.text }
    ])

    const result = await applyMemoryCandidates(candidates, { similarityThreshold: 0.85 })

    expect(result.updated).toBe(1)
    expect(result.created).toBe(0)
    expect(mockVectorService.search).toHaveBeenCalledWith(candidates[0].text, 1, 'memories')
    
    // Check if store was updated with merged tags and importance (indirectly via writeFile check)
    const writeCall = fs.writeFile.mock.calls.find(c => c[0].endsWith('memories.json'))
    const savedData = JSON.parse(writeCall[1])
    const updatedItem = savedData.items.find((it: any) => it.id === 'mem-1')
    expect(updatedItem.tags).toContain('db')
    expect(updatedItem.tags).toContain('database')
    expect(updatedItem.importance).toBe(0.8)
  })

  it('creates a new memory if semantic similarity is low', async () => {
     const candidates: MemoryCandidate[] = [
      { type: 'decision', text: 'Use PNPM instead of NPM', tags: ['pkg'], importance: 0.7 }
    ]

    const fs = require('node:fs/promises')
    fs.readFile.mockResolvedValue(JSON.stringify({ 
      version: 1, 
      items: [] 
    }))

    // Mock semantic search miss (low score)
    mockVectorService.search.mockResolvedValue([
      { id: 'mem-other', score: 0.4, text: 'Some unrelated memory' }
    ])

    const result = await applyMemoryCandidates(candidates, { similarityThreshold: 0.85 })

    expect(result.created).toBe(1)
    expect(result.updated).toBe(0)
  })
})
