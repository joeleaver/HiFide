import type { AgentTool } from '../../providers/provider'
import path from 'node:path'
import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

import { resolveWorkspaceRootAsync } from '../../utils/workspace.js'
import { grepAllPages } from '../text/grep'
import { discoverWorkspaceFiles, DEFAULT_EXCLUDE_PATTERNS } from '../../utils/fileDiscovery.js'


type FileMeta = {
  path: string
  absPath: string
  ext: string
  bytes: number
  mtimeMs: number
}

type SectionItem = {
  path: string
  handle?: string
  score?: number
  details?: string
  stats?: Record<string, number | string>
}

type Section = {
  title: string
  items: SectionItem[];
}

// Convert glob patterns to segment set for quick path checks
const IGNORE_SEGMENTS = new Set(
  DEFAULT_EXCLUDE_PATTERNS
    .filter(p => p.endsWith('/**'))
    .map(p => p.replace('/**', '').replace(/\*\*\//g, ''))
)

const BINARY_EXTS = new Set([
  '.png','.jpg','.jpeg','.gif','.bmp','.webp','.ico','.pdf','.zip','.rar','.7z','.tar','.gz','.bz2','.xz',
  '.mp3','.mp4','.m4a','.mov','.avi','.mkv','.wav','.flac','.ogg','.wasm','.ttf','.otf','.woff','.woff2','.dll','.so','.dylib','.exe'
])

const CODE_EXTS = new Set(['.ts','.tsx','.cts','.mts','.js','.jsx','.cjs','.mjs','.json','.py','.go','.rs','.java','.kt','.c','.cpp','.h','.hpp'])
const EXT_RESOLUTION_ORDER = ['.ts','.tsx','.cts','.mts','.js','.jsx','.cjs','.mjs','.json','.py','.go','.rs','.java','.kt','.c','.cpp','.h','.hpp']

const MAX_DEP_ITEMS = 15
const MAX_LARGE_FILES = 12
const MAX_CONFIG_ITEMS = 12
const MAX_TREE_DEPTH = 3
const MAX_TREE_CHILDREN = 12
const MAX_STRUCTURAL_SCAN = 50

const SYMBOL_REGEX = /\b(class|function|def|struct|interface|enum|type|const|let|var|func)\b/g

const LANGUAGE_LABELS: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (React)',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript (React)',
  '.mjs': 'JavaScript (ESM)',
  '.cjs': 'JavaScript (CJS)',
  '.mts': 'TypeScript (ESM)',
  '.cts': 'TypeScript (CJS)',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.json': 'JSON',
  '.c': 'C',
  '.cpp': 'C++',
  '.h': 'C header',
  '.hpp': 'C++ header'
};


const IMPORT_SCAN_CONFIG = [
  {
    pattern: '^\\s*(?:from|import)\\s+[\\.\\w_]+',
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}'],
    extractor: (line: string) => extractSpecs(line, 'js'),
  },
  {
    pattern: '^\\s*import\\s+(?:\\(|[\'\"`])',
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}'],
    extractor: (line: string) => extractSpecs(line, 'js'),
  },
  {
    pattern: '^\\s*(?:from|import)\\s+[\\.\\w_]+',
    files: ['**/*.py'],
    extractor: (line: string) => extractSpecs(line, 'py'),
  },
  {
    pattern: '^\\s*import\\s+(?:\\(|[\'\"`])',
    files: ['**/*.go'],
    extractor: (line: string) => extractSpecs(line, 'go'),
  },
  {
    pattern: '^\\s*(?:use|mod)\\s+[^;]+;',
    files: ['**/*.rs'],
    extractor: (line: string) => extractSpecs(line, 'rs'),
  },
  {
    pattern: '^\\s*import\\s+[A-Za-z0-9_\\.]+',
    files: ['**/*.{java,kt}'],
    extractor: (line: string) => extractSpecs(line, 'java'),
  }
]

function toHandle(pathRel: string, start: number, end: number): string {
  const payload = { t: 'h', p: pathRel.replace(/\\/g, '/'), s: start | 0, e: end | 0 }
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64')
}

function toPosix(rel: string): string {
  return rel.replace(/\\/g, '/')
}

function looksBinary(ext: string): boolean {
  return BINARY_EXTS.has(ext.toLowerCase())
}

async function gatherWorkspaceFiles(root: string): Promise<FileMeta[]> {
  // Use shared discoverWorkspaceFiles which respects .gitignore and excludes binary files
  const absPaths = await discoverWorkspaceFiles({
    cwd: root,
    includeGlobs: ['**/*'],
    respectGitignore: true,
    includeDotfiles: true,
    absolute: true,
    excludeBinaryFiles: true,
  })

  const metas: FileMeta[] = []
  const limit = Math.max(4, Math.min(32, absPaths.length))
  let index = 0

  await Promise.all(Array.from({ length: limit }, async () => {
    while (index < absPaths.length) {
      const abs = absPaths[index++]
      const rel = toPosix(path.relative(root, abs))
      try {
        const stat = await fs.stat(abs)
        metas.push({ path: rel, absPath: abs, ext: path.extname(rel).toLowerCase(), bytes: stat.size || 0, mtimeMs: stat.mtimeMs || 0 })
      } catch {/* ignore */}
    }
  }))

  return metas
}

function extractSpecs(line: string, mode: 'js' | 'py' | 'go' | 'rs' | 'java'): string[] {
  const specs: string[] = []
  if (mode === 'js') {
    const regList = [
      /import[^;]+?from\s+['"]([^'"]+)['"]/g,
      /export[^;]+?from\s+['"]([^'"]+)['"]/g,
      /require\(\s*['"]([^'"]+)['"]\s*\)/g,
      /import\(\s*['"]([^'"]+)['"]\s*\)/g
    ]
    for (const reg of regList) {
      let match: RegExpExecArray | null
      while ((match = reg.exec(line))) {
        if (match[1]) specs.push(match[1])
      }
    }
  } else if (mode === 'py') {
    const fromRe = /from\s+([\w\._]+)/g
    const importRe = /import\s+([\w\._]+)/g
    let m: RegExpExecArray | null
    while ((m = fromRe.exec(line))) { specs.push(m[1]) }
    while ((m = importRe.exec(line))) { specs.push(m[1]) }
  } else if (mode === 'go') {
    const singleRe = /import\s+(?:\(|)(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g
    let m: RegExpExecArray | null
    while ((m = singleRe.exec(line))) {
      const spec = m[1] || m[2] || m[3]
      if (spec) specs.push(spec)
    }
  } else if (mode === 'rs') {
    const useRe = /use\s+([^;]+);/g
    const modRe = /mod\s+([\w_]+);/g
    let m: RegExpExecArray | null
    while ((m = useRe.exec(line))) { specs.push(m[1]) }
    while ((m = modRe.exec(line))) { specs.push('./' + (m[1] || '').trim()) }
  } else if (mode === 'java') {
    const impRe = /import\s+([A-Za-z0-9_\.]+)/g
    let m: RegExpExecArray | null
    while ((m = impRe.exec(line))) { specs.push(m[1]) }
  }
  return specs
}

function sanitizeSpecifier(spec: string): string {
  return spec.replace(/[#?].*$/, '').trim()
}

function pushCandidateVariants(list: string[], base: string) {
  const normalized = base.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '')
  const clean = normalized.replace(/^\.\//, '')
  if (clean) list.push(clean)
  for (const ext of EXT_RESOLUTION_ORDER) {
    if (!clean.endsWith(ext)) list.push(`${clean}${ext}`)
  }
  for (const ext of EXT_RESOLUTION_ORDER) {
    list.push(path.posix.join(clean, `index${ext}`))
  }
  list.push(path.posix.join(clean, '__init__.py'))
}

function resolveImportTarget(source: string, specRaw: string, metaByPath: Map<string, FileMeta>): string | null {
  if (!specRaw) return null
  const spec = sanitizeSpecifier(specRaw)
  if (!spec) return null
  const candidates: string[] = []

  const srcDir = path.posix.dirname(source)
  if (spec.startsWith('.')) {
    const joined = path.posix.normalize(path.posix.join(srcDir, spec))
    pushCandidateVariants(candidates, joined)
  } else if (spec.startsWith('/')) {
    pushCandidateVariants(candidates, spec.slice(1))
  } else {
    const dotted = spec.includes('.') ? spec.replace(/\./g, '/') : spec
    if (dotted) pushCandidateVariants(candidates, dotted)
  }

  for (const cand of candidates) {
    if (metaByPath.has(cand)) return cand
  }
  return null
}

async function computeDependencyCentrality(metaByPath: Map<string, FileMeta>): Promise<Section | null> {
  const incoming = new Map<string, Set<string>>()
  let totalMatches = 0

  for (const cfg of IMPORT_SCAN_CONFIG) {
    for await (const page of grepAllPages({
      pattern: cfg.pattern,
      files: cfg.files,
      options: { lineNumbers: true, maxResults: 2000, ignoreCase: false }
    })) {
      const matches = Array.isArray(page?.data?.matches) ? page.data.matches : []
      totalMatches += matches.length
      for (const match of matches) {
        const file = toPosix(match.file || '')
        if (!file) continue
        const specs = cfg.extractor(String(match.line || ''))
        if (!specs.length) continue
        for (const spec of specs) {
          const target = resolveImportTarget(file, spec, metaByPath)
          if (!target || target === file) continue
          if (!incoming.has(target)) incoming.set(target, new Set())
          incoming.get(target)!.add(file)
        }
      }
    }
  }

  if (!incoming.size) return null

  const ranked = Array.from(incoming.entries()).map(([target, refs]) => {
    const refDirs = new Set(Array.from(refs).map((p) => path.posix.dirname(p)))
    const refCount = refs.size
    const dirCount = refDirs.size
    const score = refCount + dirCount * 0.1
    return { target, refCount, dirCount, score }
  }).sort((a, b) => b.score - a.score).slice(0, MAX_DEP_ITEMS)

  return {
    title: 'Core modules by dependency influence',
    items: ranked.map((entry) => ({
      path: entry.target,
      handle: toHandle(entry.target, 1, 1),
      score: Number(entry.score.toFixed(2)),
      stats: { references: entry.refCount, referencingDirs: entry.dirCount }
    }))
  }
}

async function analyzeLargestModules(meta: FileMeta[]): Promise<Section | null> {
  const candidates = meta.filter((m) => CODE_EXTS.has(m.ext) && !looksBinary(m.ext) && m.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, MAX_STRUCTURAL_SCAN)

  const analyses: Array<{ meta: FileMeta; lines: number; symbols: number }> = []
  for (const file of candidates) {
    try {
      const buf = await fs.readFile(file.absPath, 'utf-8')
      const lines = buf.split(/\r?\n/).length
      const symMatches = buf.match(SYMBOL_REGEX)
      analyses.push({ meta: file, lines, symbols: symMatches ? symMatches.length : 0 })
    } catch {/* ignore */}
  }

  if (!analyses.length) return null

  const top = analyses.sort((a, b) => b.meta.bytes - a.meta.bytes).slice(0, MAX_LARGE_FILES)
  return {
    title: 'Largest / densest modules',
    items: top.map(({ meta: fm, lines, symbols }) => ({
      path: fm.path,
      handle: toHandle(fm.path, 1, 1),
      stats: {
        bytes: fm.bytes,
        lines,
        symbols
      }
    }))
  }
}

async function summarizeConfig(meta: FileMeta): Promise<string | null> {
  try {
    const buf = await fs.readFile(meta.absPath, 'utf-8')
    const sample = buf.slice(0, 20000)
    const trimmed = sample.trim()
    const signals: string[] = []

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) signals.push('Structured data')
    if (/^\s*\w+\s*[:=]/m.test(sample)) signals.push('Key/value directives')
    if (/dependencies/i.test(sample)) signals.push('Declares dependencies')
    if (/scripts?/i.test(sample)) signals.push('Defines scripts')
    if (/services/i.test(sample)) signals.push('Mentions services')
    if (/^\s*\[tool\./m.test(sample)) signals.push('TOML tool section')
    if (/^#!\s*\/(usr\/)?bin\//.test(sample)) signals.push('Executable script')
    if (/FROM\s+\S+/i.test(sample)) signals.push('Container build instructions')
    if (/pipeline|workflow/i.test(sample)) signals.push('CI/CD keywords')
    if (/compilerOptions|settings|plugins/i.test(sample)) signals.push('Compiler/settings block')

    if (!signals.length) return null
    return signals.slice(0, 4).join('; ')
  } catch {
    return null
  }
}

async function detectConfigurationAnchors(meta: FileMeta[]): Promise<Section | null> {
  const candidates = meta
    .filter((m) => m.bytes > 0 && m.bytes < 200_000)
    .filter((m) => {
      const depth = m.path.split('/').length
      return depth <= 3
    })

  const items: SectionItem[] = []
  for (const file of candidates) {
    const details = await summarizeConfig(file)
    if (details) {
      items.push({ path: file.path, handle: toHandle(file.path, 1, 1), details })
      if (items.length >= MAX_CONFIG_ITEMS) break
    }
  }

  if (!items.length) return null
  return { title: 'Detected configuration anchors', items }
}

function shouldIgnoreForTree(relPath: string): boolean {
  const parts = relPath.split('/').filter(Boolean)
  return parts.some((segment) => IGNORE_SEGMENTS.has(segment))
}

async function buildDirectoryTree(root: string): Promise<{ markdown: string; entries: number }> {
  const lines: string[] = ['.']
  let count = 0

  async function walk(relDir: string, prefix: string, depth: number): Promise<void> {
    if (depth > MAX_TREE_DEPTH) return
    const abs = path.join(root, relDir)
    let dirents: Dirent[] = []
    try {
      dirents = await fs.readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    const children = dirents
      .filter((dirent) => {
        const childRel = relDir ? `${relDir}/${dirent.name}` : dirent.name
        if (shouldIgnoreForTree(childRel)) return false
        return true
      })
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      .slice(0, MAX_TREE_CHILDREN)

    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      const isLast = i === children.length - 1
      const childRel = relDir ? `${relDir}/${child.name}` : child.name
      const connector = isLast ? '└── ' : '├── '
      const nextPrefix = prefix + (isLast ? '    ' : '│   ')
      const display = child.isDirectory() ? `${child.name}/` : child.name
      lines.push(`${prefix}${connector}${display}`)
      count++
      if (child.isDirectory() && depth < MAX_TREE_DEPTH) {
        await walk(childRel, nextPrefix, depth + 1)
      }
    }
  }

  await walk('', '', 1)

  const markdown = ['```', ...lines, '```'].join('\n')
  return { markdown, entries: count }
}

function summarizeExtensions(meta: FileMeta[]) {
  const counts = new Map<string, number>()
  for (const file of meta) {
    const ext = file.ext || '<none>'
    counts.set(ext, (counts.get(ext) ?? 0) + 1)
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  return sorted.slice(0, 8).map(([ext, count]) => {
    const label = LANGUAGE_LABELS[ext] ?? ext
    return `${label} (${count})`
  })
}

export const workspaceMapTool: AgentTool = {
  name: 'workspaceMap',
  description: 'Get project structure overview.',
  parameters: { type: 'object', properties: {} },
  run: async (_args?: Record<string, never>, meta?: any) => {
    const t0 = Date.now()
    const root = await resolveWorkspaceRootAsync(meta?.workspaceId)
    const files = await gatherWorkspaceFiles(root)
    const metaByPath = new Map(files.map((m) => [toPosix(m.path), m]))

    const sections: Section[] = []

    const depSection = await computeDependencyCentrality(metaByPath)
    if (depSection) sections.push(depSection)

    const largeSection = await analyzeLargestModules(files)
    if (largeSection) sections.push(largeSection)

    const configSection = await detectConfigurationAnchors(files)
    if (configSection) sections.push(configSection)

    const tree = await buildDirectoryTree(root)
    sections.push({
      title: 'Directory tree',
      items: [{ path: '.', details: tree.markdown, stats: { depth: MAX_TREE_DEPTH, shownEntries: tree.entries } }]
    })

    const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0)
    const maxFileBytes = files.reduce((max, f) => Math.max(max, f.bytes), 0)

    const metaSummary = {
      elapsedMs: Date.now() - t0,
      totalFiles: files.length,
      totalBytes,
      maxFileBytes,
      detectedLanguages: summarizeExtensions(files)
    }

    return { ok: true, data: { root: root.replace(/\\/g, '/'), sections, meta: metaSummary } }
  },
  toModelResult: (raw: any) => {
    if (raw?.ok && raw?.data) {
      const previewKey = randomUUID()
      return {
        minimal: {
          ok: true,
          summary: `Workspace map generated (${raw.data.sections?.length || 0} sections)` ,
          previewKey
        },
        ui: raw.data,
        previewKey
      }
    }
    return { minimal: raw }
  }
}

export default workspaceMapTool
