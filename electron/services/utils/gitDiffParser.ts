import crypto from 'node:crypto'
import type { GitDiffHunk, GitDiffLine } from '../../../shared/git.js'

export interface ParseUnifiedDiffOptions {
  /**
   * When true, tolerate non-standard lines and keep parsing.
   * v1: keep strict-ish but don't throw for unknown headers.
   */
  lenient?: boolean
}

const HUNK_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/

export interface ParsedUnifiedDiff {
  hunks: GitDiffHunk[]
  /** true if diff indicates binary or could not be represented as hunks */
  isBinary: boolean
  /** optional signature for caching */
  signature: string
}

export function parseUnifiedDiff(patch: string, opts: ParseUnifiedDiffOptions = {}): ParsedUnifiedDiff {
  const text = patch ?? ''

  // Heuristic: git uses these markers for binary diffs
  if (text.includes('GIT binary patch') || text.includes('Binary files ') || text.includes('literal ')) {
    return { hunks: [], isBinary: true, signature: sha1(text) }
  }

  const lines = text.split(/\r?\n/)
  const hunks: GitDiffHunk[] = []

  let current: GitDiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  const pushCurrent = () => {
    if (current) hunks.push(current)
    current = null
  }

  for (const rawLine of lines) {
    if (!rawLine) continue

    const hunkMatch = rawLine.match(HUNK_RE)
    if (hunkMatch) {
      pushCurrent()
      const oldStart = Number(hunkMatch[1])
      const oldLines = Number(hunkMatch[2] ?? '1')
      const newStart = Number(hunkMatch[3])
      const newLines = Number(hunkMatch[4] ?? '1')
      const trailing = hunkMatch[5] ?? ''

      current = {
        header: `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@${trailing}`,
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: [],
      }
      oldLine = oldStart
      newLine = newStart
      continue
    }

    if (!current) {
      // Ignore diff headers (diff --git, index, ---/+++, etc.)
      continue
    }

    // Skip file headers that sometimes show up inside a combined diff
    if (rawLine.startsWith('diff --git ') || rawLine.startsWith('index ') || rawLine.startsWith('--- ') || rawLine.startsWith('+++ ')) {
      continue
    }

    const prefix = rawLine[0]
    const body = rawLine.slice(1)

    if (prefix === '+') {
      const line: GitDiffLine = { type: 'add', text: body, newLineNumber: newLine }
      current.lines.push(line)
      newLine += 1
      continue
    }

    if (prefix === '-') {
      const line: GitDiffLine = { type: 'del', text: body, oldLineNumber: oldLine }
      current.lines.push(line)
      oldLine += 1
      continue
    }

    if (prefix === ' ') {
      const line: GitDiffLine = { type: 'context', text: body, oldLineNumber: oldLine, newLineNumber: newLine }
      current.lines.push(line)
      oldLine += 1
      newLine += 1
      continue
    }

    if (rawLine === '\\ No newline at end of file') {
      // attach as context metadata-ish line (keep text for display)
      const line: GitDiffLine = { type: 'context', text: rawLine }
      current.lines.push(line)
      continue
    }

    if (!opts.lenient) {
      // Unknown line prefix inside hunk; keep as context to avoid hard failures.
      const line: GitDiffLine = { type: 'context', text: rawLine }
      current.lines.push(line)
    }
  }

  pushCurrent()

  return { hunks, isBinary: false, signature: sha1(text) }
}

function sha1(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex')
}
