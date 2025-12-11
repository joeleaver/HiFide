import { describe, it, expect } from '@jest/globals'
import { nextMarkdownCanonicalizationExpiry, shouldCanonicalizeMarkdownChange, MARKDOWN_CANONICALIZATION_WINDOW_MS } from '../utils/markdownCanonicalization'

describe('markdown canonicalization helpers', () => {
  it('produces an expiry timestamp in the future', () => {
    const base = Date.now()
    const expiry = nextMarkdownCanonicalizationExpiry(base)
    expect(expiry).toBeGreaterThan(base)
    expect(expiry - base).toBe(MARKDOWN_CANONICALIZATION_WINDOW_MS)
  })

  it('allows canonicalization within the window for markdown tabs', () => {
    const now = 1000
    const tab = { isMarkdown: true, markdownCanonicalizationExpiry: now + 500 }
    expect(shouldCanonicalizeMarkdownChange(tab, now + 200)).toBe(true)
  })

  it('blocks canonicalization when the window has passed or tab is dirty', () => {
    const now = 5000
    expect(shouldCanonicalizeMarkdownChange({ isMarkdown: true, markdownCanonicalizationExpiry: now - 1 }, now)).toBe(false)
    expect(shouldCanonicalizeMarkdownChange({ isMarkdown: false, markdownCanonicalizationExpiry: now + 1000 }, now)).toBe(false)
    expect(shouldCanonicalizeMarkdownChange({ isMarkdown: true }, now)).toBe(false)
    expect(shouldCanonicalizeMarkdownChange({ isMarkdown: true, markdownCanonicalizationExpiry: now + 1000, isDirty: true }, now)).toBe(false)
  })
})
