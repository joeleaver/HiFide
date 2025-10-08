import { memo, useMemo } from 'react'
import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import '../styles/markdown.css'

export default memo(function Markdown({ content }: { content: string }) {
  const md = useMemo(() => new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    highlight: (str: string, lang: string) => {
      try {
        if (lang && hljs.getLanguage(lang)) {
          return `<pre><code class="hljs">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
        }
        return `<pre><code class="hljs">${hljs.highlightAuto(str).value}</code></pre>`
      } catch {
        return `<pre><code>${str}</code></pre>`
      }
    },
  }), [])

  const html = useMemo(() => {
    const raw = md.render(content || '')
    return DOMPurify.sanitize(raw)
  }, [content, md])

  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
})

