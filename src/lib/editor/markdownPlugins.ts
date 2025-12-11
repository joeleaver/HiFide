import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ChangeCodeMirrorLanguage,
  CodeToggle,
  ConditionalContents,
  InsertCodeBlock,
  ListsToggle,
  toolbarPlugin,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  markdownShortcutPlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  thematicBreakPlugin,
  frontmatterPlugin,
  UndoRedo,
  type RealmPlugin,
} from '@mdxeditor/editor'
import { createElement, Fragment, type ReactElement } from 'react'
import { markdownPluginKeys, type MarkdownPluginKey } from './markdownPluginRegistry'

const CODE_LANGUAGES: Record<string, string> = {
  '': 'Plain Text',
  txt: 'Plain Text',
  text: 'Plain Text',
  plaintext: 'Plain Text',
  plain: 'Plain Text',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TypeScript (React)',
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JavaScript (React)',
  json: 'JSON',
  css: 'CSS',
  html: 'HTML',
  xml: 'XML',
  bash: 'Bash',
  sh: 'Shell',
  shell: 'Shell',
  powershell: 'PowerShell',
  ps: 'PowerShell',
  ps1: 'PowerShell',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  ini: 'INI',
  env: 'dotenv',
  dockerfile: 'Dockerfile',
  docker: 'Dockerfile',
  sql: 'SQL',
  diff: 'Diff',
  md: 'Markdown',
  markdown: 'Markdown',
  mdx: 'MDX',
  py: 'Python',
  python: 'Python',
  rb: 'Ruby',
  ruby: 'Ruby',
  go: 'Go',
  rs: 'Rust',
  rust: 'Rust',
  cs: 'C#',
  csharp: 'C#',
  java: 'Java',
  kt: 'Kotlin',
  kotlin: 'Kotlin',
  php: 'PHP',
  swift: 'Swift',
  c: 'C',
  cpp: 'C++',
  cxx: 'C++',
  h: 'C/C++ Header',
}

const ToolbarContents = (): ReactElement =>
  createElement(
    Fragment,
    null,
    createElement(UndoRedo, null),
    createElement(BoldItalicUnderlineToggles, { options: ['Bold', 'Italic', 'Underline'] }),
    createElement(CodeToggle, null),
    createElement(BlockTypeSelect, null),
    createElement(ListsToggle, null),
    createElement(InsertCodeBlock, null),
    createElement(ConditionalContents, {
      options: [
        {
          when: (editor) => editor?.editorType === 'codeblock',
          contents: () => createElement(ChangeCodeMirrorLanguage, null),
        },
      ],
    })
  )

const pluginBuilders: Record<MarkdownPluginKey, () => RealmPlugin> = {
  toolbar: () => toolbarPlugin({ toolbarContents: ToolbarContents }),
  headings: () => headingsPlugin(),
  lists: () => listsPlugin(),
  quote: () => quotePlugin(),
  shortcuts: () => markdownShortcutPlugin(),
  codeblock: () =>
    codeBlockPlugin({
      defaultCodeBlockLanguage: '',
    }),
  codemirror: () =>
    codeMirrorPlugin({
      codeBlockLanguages: CODE_LANGUAGES,
      autoLoadLanguageSupport: true,
    }),
  'thematic-break': () => thematicBreakPlugin(),
  frontmatter: () => frontmatterPlugin(),
}

export const markdownPlugins: RealmPlugin[] = markdownPluginKeys.map((key) => {
  const build = pluginBuilders[key]
  return build()
})
