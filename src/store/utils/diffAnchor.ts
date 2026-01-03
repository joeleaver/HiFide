// Avoid Node-only crypto in the renderer test/runtime; use a tiny deterministic
// hash (FNV-1a 32-bit) instead.
import type { DiffAnchor } from '../../../shared/sourceControlAnnotations'
import type { GitDiffLine } from '../../../shared/git'

export type AnchorContextOptions = {
  /** Number of diff lines to include before the target offset. */
  before: number
  /** Number of diff lines to include after the target offset. */
  after: number
}

const DEFAULT_CTX: AnchorContextOptions = { before: 2, after: 2 }

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    // hash *= 16777619 (with overflow)
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * Computes a stable-ish hash from a small window of diff lines.
 *
 * Notes:
 * - We hash a small window of *content* (not add/remove classification) so
 *   annotations can survive minor upstream shifts.
 */
export function computeDiffContextHash(
  lines: GitDiffLine[],
  focusOffset: number,
  opts: Partial<AnchorContextOptions> = {},
): string {
  // Normalize focus to a non-context diff line when possible so anchors are
  // resilient to insertion/removal of nearby context lines.
  let effectiveFocus = focusOffset
  if (effectiveFocus >= 0 && effectiveFocus < lines.length) {
    if (lines[effectiveFocus]?.type === 'context') {
      let found = -1
      for (let d = 1; d <= 3; d++) {
        const down = effectiveFocus + d
        const up = effectiveFocus - d
        if (down < lines.length && lines[down]?.type !== 'context') {
          found = down
          break
        }
        if (up >= 0 && lines[up]?.type !== 'context') {
          found = up
          break
        }
      }
      if (found !== -1) effectiveFocus = found
    }
  }

  const { before, after } = { ...DEFAULT_CTX, ...opts }
  const start = Math.max(0, effectiveFocus - before)
  const end = Math.min(lines.length, effectiveFocus + after + 1)
  const window = lines
    .slice(start, end)
    // Ignore 'context' vs 'add'/'remove' so annotations can survive cases where
    // the same line flips classification due to minor upstream changes.
    .map((l) => l.text)
    .join('\n')
  return fnv1a32(window)
}

export type ReattachResult =
  | { ok: true; hunkIndex: number; lineOffsetInHunk?: number }
  | { ok: false; reason: 'hunk-not-found' | 'line-not-found' }

/**
 * Attempts to reattach an existing anchor to a *new* parsed diff.
 *
 * Strategy (v1):
 * 1) If hunkIndex exists, try it first.
 * 2) Search nearby hunks for matching contextHash.
 * 3) Fallback: scan all hunks.
 */
export function reattachAnchor(
  anchor: DiffAnchor,
  hunks: { lines: GitDiffLine[] }[],
): ReattachResult {
  const candidates: number[] = []
  if (anchor.hunkIndex >= 0 && anchor.hunkIndex < hunks.length) {
    candidates.push(anchor.hunkIndex)
    for (let d = 1; d <= 3; d++) {
      if (anchor.hunkIndex - d >= 0) candidates.push(anchor.hunkIndex - d)
      if (anchor.hunkIndex + d < hunks.length) candidates.push(anchor.hunkIndex + d)
    }
  }
  for (let i = 0; i < hunks.length; i++) {
    if (!candidates.includes(i)) candidates.push(i)
  }

  for (const hunkIndex of candidates) {
    const lines = hunks[hunkIndex]?.lines ?? []
    if (anchor.kind === 'hunk') {
      // Hunk-level: match any window within the hunk.
      for (let off = 0; off < lines.length; off++) {
        if (computeDiffContextHash(lines, off) === anchor.contextHash) {
          return { ok: true, hunkIndex }
        }
      }
    } else {
      // Line-level: try the old offset first, then scan.
      const preferred = anchor.lineOffsetInHunk
      if (preferred >= 0 && preferred < lines.length) {
        if (computeDiffContextHash(lines, preferred) === anchor.contextHash) {
          return { ok: true, hunkIndex, lineOffsetInHunk: preferred }
        }
      }
      for (let off = 0; off < lines.length; off++) {
        if (computeDiffContextHash(lines, off) === anchor.contextHash) {
          return { ok: true, hunkIndex, lineOffsetInHunk: off }
        }
      }
    }
  }

  return { ok: false, reason: anchor.kind === 'hunk' ? 'hunk-not-found' : 'line-not-found' }
}

