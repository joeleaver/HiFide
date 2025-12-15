type LinkDefinition = {
  url: string
  title?: string
}

const LINK_DEFINITION_REGEX = /^[ \t]{0,3}\[([^\]]+)\]:\s*(<[^>]+>|\S+)(?:\s+("[^"]*"|'[^']*'|\([^)]*\)))?\s*$/gim

function createLinkDefinitionRegex(): RegExp {
  return new RegExp(LINK_DEFINITION_REGEX.source, LINK_DEFINITION_REGEX.flags)
}

function stripEnclosing(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  const isWrapped =
    (first === '"' && last === '"') ||
    (first === '\'' && last === '\'') ||
    (first === '(' && last === ')')
  return isWrapped ? trimmed.slice(1, -1).trim() : trimmed
}

function formatUrl(raw: string): string {
  let url = raw.trim()
  if (url.startsWith('<') && url.endsWith('>')) {
    url = url.slice(1, -1)
  }
  return url
}


function collectLinkDefinitions(markdown: string): Map<string, LinkDefinition> {
  const defs = new Map<string, LinkDefinition>()
  const matcher = createLinkDefinitionRegex()
  for (const match of markdown.matchAll(matcher)) {
    const [, rawLabel, rawUrl, rawTitle] = match
    const label = rawLabel?.trim().toLowerCase()
    if (!label || label.startsWith('^')) continue // skip footnotes
    const url = formatUrl(rawUrl || '')
    if (!url) continue
    const title = stripEnclosing(rawTitle)
    defs.set(label, title ? { url, title } : { url })
  }
  return defs
}

function shouldSkipShortcut(source: string, offset: number, matchLength: number): boolean {
  const prevChar = offset > 0 ? source[offset - 1] : ''
  if (prevChar === '[' || prevChar === '\\') return true
  const nextChar = source[offset + matchLength] ?? ''
  if (nextChar === '(' || nextChar === '[' || nextChar === ':' ) return true
  return false
}

/**
 * Convert reference-style markdown links ("[text][ref]", "[ref][]", or shortcut references)
 * into inline links so the MDXEditor parser doesn't encounter unsupported linkReference nodes.
 */
export function normalizeReferenceLinks(markdown: string): string {
  if (!markdown) return ''
  const defs = collectLinkDefinitions(markdown)
  if (!defs.size) return markdown

  const renderReplacement = (text: string, label: string, isImage = false): string | null => {
    const def = defs.get(label.trim().toLowerCase())
    if (!def) return null
    const needsAngles = /\s/.test(def.url)
    const target = needsAngles ? `<${def.url.replace(/>/g, '\\>')}>` : def.url
    const titleSuffix = def.title ? ` "${def.title.replace(/"/g, '\\"')}"` : ''
    const prefix = isImage ? '!' : ''
    return `${prefix}[${text}](${target}${titleSuffix})`
  }

  const fullRefRegex = /\[([^\]]+)\](\s*)\[([^\]]*)\]/g
  let transformed = markdown.replace(fullRefRegex, (match, text, _spacing, label, offset, source) => {
    const prevChar = offset > 0 ? source[offset - 1] : ''
    if (prevChar === '\\') return match
    const isImage = prevChar === '!'
    const replacement = renderReplacement(text, (label || text).trim(), isImage)
    return replacement ?? match
  })

  const shortcutRegex = /\[([^\]]+)\]/g
  transformed = transformed.replace(shortcutRegex, (match, label, offset, source) => {
    if (shouldSkipShortcut(source, offset, match.length)) return match
    const prevChar = offset > 0 ? source[offset - 1] : ''
    const replacement = renderReplacement(label, label, prevChar === '!')
    return replacement ?? match
  })

  const remover = createLinkDefinitionRegex()
  transformed = transformed.replace(remover, (definition, rawLabel) => {
    const normalizedLabel = rawLabel?.trim().toLowerCase()
    return normalizedLabel && defs.has(normalizedLabel) ? '' : definition
  })

  return transformed.replace(/\n{3,}/g, '\n\n')
}
