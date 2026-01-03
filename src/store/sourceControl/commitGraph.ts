import type { GitLogCommit } from '../../../shared/gitLog'
import type { CommitGraphRow } from '../../components/sourceControl/HistoryView'

// v1 lane assignment:
// - Deterministic within the loaded window.
// - Treat the log order as top-to-bottom.
// - Keep active lanes for "expected next shas" (first-parent continuity + merges open temporary lanes).
//
// Limitations (documented in KB):
// - Paging: lanes may change when earlier commits are loaded because the window changes.
// - Connectors are best-effort within the loaded window; no cross-page continuity.

export function buildCommitGraphRows(commits: GitLogCommit[]): CommitGraphRow[] {
  const rows: CommitGraphRow[] = []
  const lanes: Array<{ nextSha: string | null }> = []

  // sha -> lane index (best-effort) within the current window.
  const laneBySha = new Map<string, number>()

  const ensureLaneForSha = (sha: string): number => {
    const existing = lanes.findIndex((l) => l.nextSha === sha)
    if (existing >= 0) return existing
    lanes.push({ nextSha: sha })
    return lanes.length - 1
  }

  const compactLanes = () => {
    // Remove trailing empty lanes
    while (lanes.length > 0 && lanes[lanes.length - 1]!.nextSha === null) lanes.pop()
  }

  for (let rowIndex = 0; rowIndex < commits.length; rowIndex++) {
    const c = commits[rowIndex]!
    const lane = ensureLaneForSha(c.sha)

    laneBySha.set(c.sha, lane)

    // Update this lane to continue on first parent, if any.
    lanes[lane]!.nextSha = c.parents[0] ?? null

    // For additional parents (merges), ensure lanes exist for those SHAs
    // so future commits can be placed deterministically.
    for (let i = 1; i < c.parents.length; i++) {
      ensureLaneForSha(c.parents[i]!)
    }

    compactLanes()
    const lanesCount = Math.max(1, lanes.length)

    // Connector segments are computed in the coordinate space of GraphColumn:
    // width = lanesCount * gap, height = size.
    const gap = 10
    const size = 14
    const cy = size / 2
    const cx = lane * gap + gap / 2
    const connectors: Array<{ x1: number; y1: number; x2: number; y2: number }> = []

    // Always draw a short vertical continuation for the current lane.
    connectors.push({ x1: cx, y1: 0, x2: cx, y2: size })

    // If this is a merge, draw diagonals toward secondary parents when present in the window.
    if (c.parents.length > 1) {
      for (let i = 1; i < c.parents.length; i++) {
        const p = c.parents[i]!
        const targetLane = laneBySha.get(p)
        if (targetLane === undefined) continue
        const tx = targetLane * gap + gap / 2
        connectors.push({ x1: cx, y1: cy, x2: tx, y2: size })
      }
    }

    rows.push({
      sha: c.sha,
      lane,
      lanesCount,
      isMerge: c.parents.length > 1,
      parents: c.parents,
      connectors,
    })
  }

  return rows
}

