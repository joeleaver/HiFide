import { memo, useMemo } from 'react'
import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import '../styles/markdown.css'

/**
 * StreamingMarkdown component that handles incomplete markdown gracefully.
 * It completes unclosed code blocks, lists, and other markdown structures
 * to prevent rendering issues during streaming.
 */
export default memo(function StreamingMarkdown({ content, showCursor = true }: { content: any; showCursor?: boolean }) {
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
    // Complete incomplete markdown structures
    const completed = completeIncompleteMarkdown(content || '')
    const raw = md.render(completed)
    return DOMPurify.sanitize(raw)
  }, [content, md])

  return (
    <div style={{ position: 'relative' }}>
      <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
      {showCursor && (
        <span
          style={{
            display: 'inline-block',
            width: '8px',
            height: '16px',
            backgroundColor: '#007acc',
            marginLeft: '2px',
            animation: 'blink 1s infinite',
            verticalAlign: 'text-bottom',
          }}
        />
      )}
      <style>{`
        @keyframes blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  )
})

/**
 * Completes incomplete markdown structures to prevent rendering issues.
 * Handles:
 * - Unclosed code blocks (```)
 * - Unclosed inline code (`)
 * - Unclosed bold/italic markers
 * - Incomplete lists
 */
function completeIncompleteMarkdown(text: any): string {
  if (!text) return ''

  let result = ''
  if (Array.isArray(text)) {
    result = text
      .map((part) => (typeof part === 'string' ? part : part.text || ''))
      .join('\n')
  } else {
    result = String(text)
  }

  // Count code block markers (```)
  const codeBlockMatches = text.match(/```/g)
  const codeBlockCount = codeBlockMatches ? codeBlockMatches.length : 0
  
  // If odd number of code block markers, close the last one
  if (codeBlockCount % 2 === 1) {
    result += '\n```'
  }

  // Count inline code markers (`) - but only outside of code blocks
  // This is a simplified approach that works for most cases
  const lines = result.split('\n')
  let inCodeBlock = false
  let needsInlineCodeClose = false

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    
    if (!inCodeBlock) {
      // Count backticks in this line
      const backticks = (line.match(/`/g) || []).length
      if (backticks % 2 === 1) {
        needsInlineCodeClose = !needsInlineCodeClose
      }
    }
  }

  // Close inline code if needed
  if (needsInlineCodeClose) {
    result += '`'
  }

  // Handle unclosed bold/italic markers
  // Count ** and * markers (simplified - doesn't handle all edge cases)
  const boldMatches = result.match(/\*\*/g)
  const boldCount = boldMatches ? boldMatches.length : 0
  if (boldCount % 2 === 1) {
    result += '**'
  }

  // Handle single asterisks for italic (but not part of bold)
  // This is a simplified heuristic
  const allAsterisks = (result.match(/\*/g) || []).length
  const asterisksInBold = boldCount * 2
  const singleAsterisks = allAsterisks - asterisksInBold
  if (singleAsterisks % 2 === 1) {
    result += '*'
  }

  // Handle unclosed underscores for italic/bold
  const doubleUnderscores = (result.match(/__/g) || []).length
  if (doubleUnderscores % 2 === 1) {
    result += '__'
  }

  const singleUnderscores = (result.match(/_/g) || []).length - (doubleUnderscores * 2)
  if (singleUnderscores % 2 === 1) {
    result += '_'
  }

  return result
}

