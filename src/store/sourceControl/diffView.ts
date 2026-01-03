import type { GitFileDiff } from '../../../shared/git'
import type { DiffAnnotation, DiffAnchor } from '../../../shared/sourceControlAnnotations'
import { computeDiffContextHash } from '../utils/diffAnchor'

export type SourceControlSelection =
  | { kind: 'hunk'; filePath: string; hunkIndex: number }
  | { kind: 'line'; filePath: string; hunkIndex: number; side: 'left' | 'right'; lineOffsetInHunk: number }
  | null

export function buildHunkAnchor(args: {
  repoRoot: string
  filePath: string
  diff: GitFileDiff
  hunkIndex: number
  diffBase: 'unstaged' | 'staged'
}): DiffAnchor {
  const hunk = args.diff.hunks[args.hunkIndex]
  const lines = hunk?.lines ?? []
  const contextHash = computeDiffContextHash(lines, 0)
  return {
    kind: 'hunk',
    repoRoot: args.repoRoot,
    filePath: args.filePath,
    diffBase: args.diffBase,
    hunkIndex: args.hunkIndex,
    contextHash,
  }
}

export function buildLineAnchor(args: {
  repoRoot: string
  filePath: string
  diff: GitFileDiff
  hunkIndex: number
  side: 'left' | 'right'
  lineOffsetInHunk: number
  diffBase: 'unstaged' | 'staged'
}): DiffAnchor {
  const hunk = args.diff.hunks[args.hunkIndex]

  const lines = hunk?.lines ?? []
  const contextHash = computeDiffContextHash(lines, args.lineOffsetInHunk)

  return {
    kind: 'line',
    repoRoot: args.repoRoot,
    filePath: args.filePath,
    diffBase: args.diffBase,
    hunkIndex: args.hunkIndex,
    side: args.side,
    lineOffsetInHunk: args.lineOffsetInHunk,
    contextHash,
  }
}

export function createAnnotation(args: {
  anchor: DiffAnchor
  body: string
}): DiffAnnotation {
  return {
    id: `ann_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    anchor: args.anchor,
    body: args.body,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}
