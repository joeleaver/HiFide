import { describe, it, expect } from '@jest/globals'
import { detectLanguageFromPath } from '../../../../shared/language'

describe('detectLanguageFromPath', () => {
  it('returns typescript for .ts files', () => {
    expect(detectLanguageFromPath('/project/src/file.ts')).toBe('typescript')
  })

  it('returns typescriptreact for .tsx files', () => {
    expect(detectLanguageFromPath('/project/src/component.tsx')).toBe('typescriptreact')
  })

  it('returns javascriptreact for .jsx files', () => {
    expect(detectLanguageFromPath('/project/src/view.jsx')).toBe('javascriptreact')
  })

  it('falls back to plaintext for unknown extensions', () => {
    expect(detectLanguageFromPath('/project/README.unknown')).toBe('plaintext')
  })
})
