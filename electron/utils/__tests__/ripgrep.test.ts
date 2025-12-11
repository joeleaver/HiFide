import path from 'node:path'
import { preferUnpackedRipgrepPath } from '../ripgrep'

describe('preferUnpackedRipgrepPath', () => {
  it('returns a normalized path when the binary lives outside app.asar', () => {
    const raw = 'C:/dev/hifide/node_modules/vscode-ripgrep/bin/rg'
    const result = preferUnpackedRipgrepPath(raw)
    expect(result).toBe(path.normalize(raw))
  })

  it('rewrites app.asar paths to app.asar.unpacked when the unpacked binary exists', () => {
    const raw = 'C:/Apps/hifide/resources/app.asar/node_modules/vscode-ripgrep/bin/rg.exe'
    const expected = path.normalize('C:/Apps/hifide/resources/app.asar.unpacked/node_modules/vscode-ripgrep/bin/rg.exe')
    const exists = jest.fn().mockReturnValue(true)

    const result = preferUnpackedRipgrepPath(raw, exists)

    expect(result).toBe(expected)
    expect(exists).toHaveBeenCalledWith(expected)
  })

  it('falls back to the original path when the unpacked binary is missing', () => {
    const raw = 'C:/Apps/hifide/resources/app.asar/node_modules/vscode-ripgrep/bin/rg.exe'
    const exists = jest.fn().mockReturnValue(false)

    const result = preferUnpackedRipgrepPath(raw, exists)

    expect(result).toBe(path.normalize(raw))
    expect(exists).toHaveBeenCalled()
  })

  it('leaves already-unpacked paths untouched', () => {
    const raw = 'C:/Apps/hifide/resources/app.asar.unpacked/node_modules/vscode-ripgrep/bin/rg.exe'
    const exists = jest.fn()

    const result = preferUnpackedRipgrepPath(raw, exists)

    expect(result).toBe(path.normalize(raw))
    expect(exists).not.toHaveBeenCalled()
  })
})
