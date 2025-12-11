import { describe, expect, it } from '@jest/globals'
import { getBasename, getParentFsPath, normalizeFsPath, pathsEqual } from '../utils/fsPath'

describe('normalizeFsPath', () => {
  it('normalizes Windows separators and trims extra slashes', () => {
    expect(normalizeFsPath('C:\\\\Projects\\\\demo\\src\\'))
      .toBe('C:/Projects/demo/src')
  })

  it('preserves root-only paths', () => {
    expect(normalizeFsPath('C:/')).toBe('C:/')
    expect(normalizeFsPath('/')).toBe('/')
  })
})

describe('getParentFsPath', () => {
  it('returns the parent directory for nested paths', () => {
    expect(getParentFsPath('C:/Projects/demo/src')).toBe('C:/Projects/demo')
    expect(getParentFsPath('/var/log/app')).toBe('/var/log')
  })

  it('returns the root for top-level paths', () => {
    expect(getParentFsPath('C:/')).toBe('C:/')
    expect(getParentFsPath('/')).toBe('/')
  })
})

describe('pathsEqual', () => {
  it('compares paths ignoring separator style', () => {
    expect(pathsEqual('C:/Projects/demo', 'C:\\Projects\\demo')).toBe(true)
    expect(pathsEqual('/var/tmp', '/var/tmp/')).toBe(true)
    expect(pathsEqual('/var/tmp', '/var/tmp2')).toBe(false)
  })
})

describe('getBasename', () => {
  it('extracts filename from nested path', () => {
    expect(getBasename('C:/repo/src/index.ts')).toBe('index.ts')
    expect(getBasename('/var/log/app.log')).toBe('app.log')
  })
})
