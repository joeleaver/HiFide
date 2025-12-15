import { normalizeReferenceLinks } from '../markdownLinkNormalizer'

describe('normalizeReferenceLinks', () => {
  it('converts full reference style links to inline links', () => {
    const input = `Use [docs][docs-link] for more info.\n\n[docs-link]: https://example.com/docs "Docs"`
    const output = normalizeReferenceLinks(input)
    expect(output).toContain('[docs](https://example.com/docs "Docs")')
    expect(output).not.toContain('[docs-link]: https://example.com/docs "Docs"')
  })

  it('handles collapsed and shortcut references', () => {
    const input = `Refer to [API][] and [design].\n\n[api]: https://example.com/api\n[design]: <https://example.com/design> 'Design System'`
    const output = normalizeReferenceLinks(input)
    expect(output).toContain('[API](https://example.com/api)')
    expect(output).toContain('[design](https://example.com/design "Design System")')
    expect(output).not.toMatch(/\[(api|design)\]:/i)
  })

  it('converts image references to inline images', () => {
    const input = `Image ![diagram][diagram-ref] and shortcut ![logo].\n\n[diagram-ref]: https://cdn.example.com/diagram.svg\n[logo]: https://cdn.example.com/logo.png "Logo"`
    const output = normalizeReferenceLinks(input)
    expect(output).toContain('![diagram](https://cdn.example.com/diagram.svg)')
    expect(output).toContain('![logo](https://cdn.example.com/logo.png "Logo")')
    expect(output).not.toMatch(/\[(diagram-ref|logo)\]:/i)
  })

  it('leaves inline links and images untouched', () => {
    const input = `Inline [link](https://keep.me) and inline image ![alt](https://cdn.example.com/img.png)`
    const output = normalizeReferenceLinks(input)
    expect(output).toContain('[link](https://keep.me)')
    expect(output).toContain('![alt](https://cdn.example.com/img.png)')
  })

  it('strips standalone reference definitions that would break MDX', () => {
    const input = `[an_awesome_website_link]: https://stackoverflow.com`
    const output = normalizeReferenceLinks(input)
    expect(output.trim()).toBe('')
  })

  it('is idempotent when run multiple times', () => {
    const input = `See [guide].\n\n[guide]: https://example.com/guide`
    const once = normalizeReferenceLinks(input)
    const twice = normalizeReferenceLinks(once)
    expect(twice).toBe(once)
  })
})
