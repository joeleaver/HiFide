import { FlowProfileService } from '../FlowProfileService'
import * as flowProfilesModule from '../flowProfiles'

afterEach(() => {
  jest.restoreAllMocks()
})

describe('FlowProfileService.saveProfile reload control', () => {
  it('skips template reload when reloadTemplates is false', async () => {
    jest.spyOn(flowProfilesModule, 'saveWorkspaceFlowProfile').mockResolvedValue({ success: true } as any)
    const service = new FlowProfileService()
    const reloadSpy = jest.spyOn(service as any, 'reloadTemplatesFor').mockResolvedValue()

    await service.saveProfile({
      workspaceId: 'ws-1',
      name: 'flow-a',
      library: 'workspace',
      nodes: [],
      edges: [],
      reloadTemplates: false,
    })

    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it('reloads templates by default', async () => {
    jest.spyOn(flowProfilesModule, 'saveWorkspaceFlowProfile').mockResolvedValue({ success: true } as any)
    const service = new FlowProfileService()
    const reloadSpy = jest.spyOn(service as any, 'reloadTemplatesFor').mockResolvedValue()

    await service.saveProfile({
      workspaceId: 'ws-2',
      name: 'flow-b',
      library: 'workspace',
      nodes: [],
      edges: [],
    })

    expect(reloadSpy).toHaveBeenCalledWith('ws-2')
  })
})
