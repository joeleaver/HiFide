jest.mock('../../services/index.js', () => ({
  getSessionService: () => ({
    getCurrentIdFor: () => null,
    getState: () => ({ sessionsByWorkspace: {} }),
  }),
}), { virtual: true })

jest.mock('../../services/agentPty', () => ({
  getOrCreateAgentPtyFor: jest.fn(),
  getSessionRecord: jest.fn(),
  beginCommand: jest.fn(),
  write: jest.fn(),
}), { virtual: true })

import { __terminalExecInternals } from '../../tools/terminal/exec'

const { getPromptSnapshot, hasPromptReturned, buildPromptSignature } = __terminalExecInternals

const createCommand = (data: string) => ({
  id: 1,
  command: 'cmd',
  startedAt: 0,
  bytes: data.length,
  data,
})

describe('terminalExec prompt helpers', () => {
  describe('getPromptSnapshot', () => {
    it('captures the last non-empty line from the ring buffer', () => {
      const ring = '\u001b[32muser@dev\u001b[0m\nPS C:/repo> '
      expect(getPromptSnapshot(ring)).toBe('PS C:/repo> ')
    })

    it('returns null when no prompt text is present', () => {
      expect(getPromptSnapshot('')).toBeNull()
    })
  })

  describe('hasPromptReturned', () => {
    it('detects when the expected prompt snapshot returns', () => {
      const prompt = 'PS C:/repo> '
      const signature = buildPromptSignature(prompt)
      const data = 'output line\nPS C:/repo> '
      expect(hasPromptReturned(createCommand(data), prompt, signature)).toBe(true)
    })

    it('falls back to generic prompt heuristics', () => {
      const data = 'done\nuser@host ~/repo$ '
      expect(hasPromptReturned(createCommand(data), null, null)).toBe(true)
    })

    it('detects prompts that add status glyphs on error', () => {
      const prompt = '➜  repo git:(main) '
      const signature = buildPromptSignature(prompt)
      const data = 'compile failed\n✗  repo git:(main) '
      expect(hasPromptReturned(createCommand(data), prompt, signature)).toBe(true)
    })

    it('handles unicode-only prompts via regex fallback', () => {
      const data = 'done\n❯ '
      expect(hasPromptReturned(createCommand(data), null, null)).toBe(true)
    })

    it('returns false when prompt markers are absent', () => {
      const data = 'still running...'
      expect(hasPromptReturned(createCommand(data), null, null)).toBe(false)
    })
  })
})
