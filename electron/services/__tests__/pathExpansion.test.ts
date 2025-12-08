import path from 'node:path'
import { describe, expect, it } from '@jest/globals'
import { expandPathPlaceholders } from '../utils/pathExpansion'

describe('expandPathPlaceholders', () => {
  it('expands leading tilde using provided home directory', () => {
    const result = expandPathPlaceholders('~/bin/mcp', {
      homeDir: '/Users/demo',
      platform: 'darwin',
      env: {},
    })

    expect(result).toBe(path.resolve('/Users/demo', 'bin/mcp'))
  })

  it('expands unix-style env placeholders', () => {
    const result = expandPathPlaceholders('${HOME}/servers/${NAME}', {
      env: { HOME: '/opt', NAME: 'alpha' },
      platform: 'linux',
      homeDir: '/home/fallback',
    })

    expect(result).toBe('/opt/servers/alpha')
  })

  it('expands Windows percent placeholders case-insensitively', () => {
    const result = expandPathPlaceholders('%UserProfile%\\mcp.exe', {
      env: { USERPROFILE: 'C:/Users/demo' },
      platform: 'win32',
      homeDir: 'C:/Users/demo',
    })

    expect(result).toBe('C:\\Users\\demo\\mcp.exe')
  })

  it('strips wrapping quotes before processing', () => {
    const result = expandPathPlaceholders('"~/quoted"', {
      homeDir: '/Users/demo',
      env: {},
      platform: 'darwin',
    })

    expect(result).toBe(path.resolve('/Users/demo', 'quoted'))
  })

  it('leaves unknown variables untouched', () => {
    const value = expandPathPlaceholders('$UNKNOWN/value', {
      env: {},
      platform: 'linux',
      homeDir: '/home/demo',
    })

    expect(value).toBe('$UNKNOWN/value')
  })
})
