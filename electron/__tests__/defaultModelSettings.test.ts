import { loadDefaultModelSettingsFile } from '../data/defaultModelSettings'

describe('defaultModelSettings.json', () => {
  it('loads and validates', () => {
    const settings = loadDefaultModelSettingsFile()
    expect(settings.version).toBe(1)
    expect(settings.pricing).toBeTruthy()
    expect(settings.pricing.openai).toBeTruthy()
    expect(settings.pricing.customRates).toBe(false)
  })

  it('contains modelDefaults map', () => {
    const settings = loadDefaultModelSettingsFile()
    expect(settings.modelDefaults).toBeTruthy()
  })
})
