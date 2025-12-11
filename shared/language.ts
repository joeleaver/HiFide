const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  json: 'json',
  md: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  py: 'python',
  rb: 'ruby',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  php: 'php',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  sql: 'sql',
  sh: 'shell',
  ps1: 'powershell',
  vue: 'vue',
  svelte: 'svelte',
}

function extractExtension(filePath: string): string {
  if (!filePath) return ''
  const normalized = filePath.replace(/\\/g, '/').split('/').pop() || ''
  const lastDot = normalized.lastIndexOf('.')
  if (lastDot === -1 || lastDot === normalized.length - 1) return ''
  return normalized.slice(lastDot + 1).toLowerCase()
}

export function detectLanguageFromPath(filePath: string): string {
  const ext = extractExtension(filePath)
  return EXTENSION_LANGUAGE_MAP[ext] ?? 'plaintext'
}

export const LANGUAGE_EXTENSION_MAP = EXTENSION_LANGUAGE_MAP
