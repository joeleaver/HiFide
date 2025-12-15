export const markdownPluginKeys = [
  'toolbar',
  'headings',
  'lists',
  'quote',
  'shortcuts',
  'codeblock',
  'codemirror',
  'table',
  'thematic-break',
  'frontmatter',
  'links',
  'link-dialog',
] as const

export type MarkdownPluginKey = (typeof markdownPluginKeys)[number]
