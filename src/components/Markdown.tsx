import { memo, useMemo } from 'react'
import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import '../styles/markdown.css'

/**
 * Normalizes code fences to ensure consistent rendering.
 * Handles:
 * - Malformed closing fences (`` instead of ```) - common OpenAI issue
 * - Extended backtick fences (4+ backticks from OpenAI) → normalized to 3
 * - Tilde fences (~~~) → converted to backticks
 * - Missing newlines before/after fences
 * - Unclosed code blocks
 * - Unclosed inline code and formatting markers
 */
function normalizeMarkdown(text: string): string {
  if (!text) return text

  let result = text

  // First pass: fix malformed closing fences (`` instead of ```)
  // OpenAI sometimes outputs only 2 backticks for closing fences
  // We need to be careful to only fix these when they appear to be fence closers
  // (i.e., on their own line, possibly with whitespace, inside a code block)
  const lines = result.split('\n')
  let inCodeBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Check for opening fence (3+ backticks with optional language)
    if (!inCodeBlock && /^`{3,}/.test(trimmed)) {
      inCodeBlock = true
      continue
    }

    // Check for proper closing fence
    if (inCodeBlock && /^`{3,}$/.test(trimmed)) {
      inCodeBlock = false
      continue
    }

    // Check for malformed closing fence (exactly 2 backticks on their own line)
    // This is the OpenAI bug: `` instead of ```
    if (inCodeBlock && /^``$/.test(trimmed)) {
      // Fix it by replacing with proper fence
      lines[i] = line.replace(/``/, '```')
      inCodeBlock = false
    }
  }

  result = lines.join('\n')

  // Normalize extended backtick fences (4+ backticks → 3)
  // OpenAI sometimes uses ```` or ````` for nested code blocks
  result = result.replace(/^(\s*)(`{4,})(\w*)/gm, '$1```$3')
  result = result.replace(/^(\s*)(`{4,})$/gm, '$1```')

  // Normalize tilde fences to backtick fences
  result = result.replace(/^(\s*)(~~~+)(\w*)/gm, '$1```$3')
  result = result.replace(/^(\s*)(~~~+)$/gm, '$1```')

  // Ensure fence markers are on their own lines
  // (e.g., "text```python" or "code```text")
  result = result.replace(/([^\n`])```(\w*)\n/g, '$1\n```$2\n')
  result = result.replace(/\n```([^\n`])/g, '\n```\n$1')

  // Second pass: track code block state for proper closing
  const normalizedLines = result.split('\n')
  inCodeBlock = false

  for (let i = 0; i < normalizedLines.length; i++) {
    const line = normalizedLines[i]
    const fenceMatch = line.match(/^(\s*)(```+)(.*)$/)

    if (fenceMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true
      } else {
        inCodeBlock = false
      }
    }
  }

  // Close any unclosed code block
  if (inCodeBlock) {
    result += '\n```'
  }

  // Handle inline code markers outside code blocks
  const finalLines = result.split('\n')
  inCodeBlock = false
  let needsInlineCodeClose = false

  for (const line of finalLines) {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock
      continue
    }

    if (!inCodeBlock) {
      const backticks = (line.match(/`/g) || []).length
      if (backticks % 2 === 1) {
        needsInlineCodeClose = !needsInlineCodeClose
      }
    }
  }

  if (needsInlineCodeClose) {
    result += '`'
  }

  // Handle unclosed bold markers
  const boldMatches = result.match(/\*\*/g)
  const boldCount = boldMatches ? boldMatches.length : 0
  if (boldCount % 2 === 1) {
    result += '**'
  }

  // Handle single asterisks for italic
  const allAsterisks = (result.match(/\*/g) || []).length
  const asterisksInBold = boldCount * 2
  const singleAsterisks = allAsterisks - asterisksInBold
  if (singleAsterisks % 2 === 1) {
    result += '*'
  }

  return result
}

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
    // Normalize markdown (fix extended fences, unclosed blocks, etc.)
    const normalized = normalizeMarkdown(content || '')
    const raw = md.render(normalized)
    return DOMPurify.sanitize(raw)
  }, [content, md])

  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
})

