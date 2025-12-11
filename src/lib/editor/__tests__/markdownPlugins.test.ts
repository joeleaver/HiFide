import { markdownPluginKeys } from '../markdownPluginRegistry'

describe('markdown plugin registry', () => {
  it('includes frontmatter and thematic break support', () => {
    expect(markdownPluginKeys).toEqual(expect.arrayContaining(['frontmatter', 'thematic-break']))
  })

  it('orders plugins deterministically', () => {
    expect(markdownPluginKeys).toMatchSnapshot()
  })
})
