export const markdownPluginKeys = [
  'toolbar',
  'headings',
  'lists',
  'quote',
  'shortcuts',
  'codeblock',
  'codemirror',
  'thematic-break',
  'frontmatter',
] as const

export type MarkdownPluginKey = (typeof markdownPluginKeys)[number]
