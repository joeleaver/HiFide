export type DiffBase = 'unstaged' | 'staged'

export type DiffSide = 'left' | 'right'

/**
 * Stable-ish anchor for an annotation against a *working tree* diff.
 *
 * We store both a positional reference (hunkIndex + optional lineOffsetInHunk)
 * and a fuzzy reference (contextHash of nearby diff lines) so we can attempt
 * re-attachment when the diff shifts due to edits.
 */
export type DiffAnchor = {
  repoRoot: string
  filePath: string
  diffBase: DiffBase

  /**
   * Index in the parsed diff hunks array at the time the annotation was created.
   */
  hunkIndex: number

  /**
   * Hash of context lines around the target position, computed from diff lines.
   * Used for fuzzy reattachment when offsets shift.
   */
  contextHash: string
} & (
  | {
      kind: 'hunk'
    }
  | {
      kind: 'line'
      side: DiffSide
      /** 0-based offset within the hunk's `lines[]` array at time of creation */
      lineOffsetInHunk: number
    }
)

export type DiffAnnotation = {
  id: string
  anchor: DiffAnchor
  body: string
  createdAt: number
  updatedAt: number
  resolvedAt?: number

  /** Optional UI labels (not used by the LLM pipeline by default). */
  tags?: string[]
}

export type DiffAnnotationsStateV1 = {
  version: 1
  annotations: DiffAnnotation[]
}

