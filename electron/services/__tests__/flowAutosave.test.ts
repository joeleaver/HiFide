import { persistAutosaveSnapshot } from '../flowAutosave'

jest.mock('../flowProfiles', () => ({
  saveWorkspaceFlowProfile: jest.fn().mockResolvedValue({ success: true }),
  saveFlowProfile: jest.fn().mockResolvedValue({ success: true }),
}))

const { saveWorkspaceFlowProfile, saveFlowProfile } = jest.requireMock('../flowProfiles')

describe('persistAutosaveSnapshot', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const baseArgs = {
    workspaceId: '/tmp/ws',
    templateId: 'demo',
    description: 'Demo flow',
    nodes: [] as any[],
    edges: [] as any[],
  }

  it('persists workspace templates via saveWorkspaceFlowProfile', async () => {
    const result = await persistAutosaveSnapshot({ ...baseArgs, library: 'workspace' })

    expect(result).toBe('saved')
    expect(saveWorkspaceFlowProfile).toHaveBeenCalledWith(baseArgs.nodes, baseArgs.edges, baseArgs.templateId, baseArgs.description, baseArgs.workspaceId)
    expect(saveFlowProfile).not.toHaveBeenCalled()
  })

  it('persists user templates via saveFlowProfile', async () => {
    const result = await persistAutosaveSnapshot({ ...baseArgs, library: 'user' })

    expect(result).toBe('saved')
    expect(saveFlowProfile).toHaveBeenCalledWith(baseArgs.nodes, baseArgs.edges, baseArgs.templateId, baseArgs.description)
    expect(saveWorkspaceFlowProfile).not.toHaveBeenCalled()
  })

  it('skips system templates', async () => {
    const result = await persistAutosaveSnapshot({ ...baseArgs, library: 'system' })

    expect(result).toBe('skipped-system')
    expect(saveFlowProfile).not.toHaveBeenCalled()
    expect(saveWorkspaceFlowProfile).not.toHaveBeenCalled()
  })
})
