import type { DiffAnnotation } from '../../../shared/sourceControlAnnotations'
import type { GitFileDiff } from '../../../shared/git'

export type SourceControlLlmContextMode = 'none' | 'annotated' | 'selectedFile'

export type SourceControlLlmContext = {
  kind: 'sourceControl.v1'
  repoRoot: string
  mode: SourceControlLlmContextMode
  generatedAt: number
  items: Array<
    | {
        type: 'file'
        path: string
        hunks: Array<{
          hunkIndex: number
          header: string
          lines: string[]
          annotations: Array<{
            id: string
            kind: 'hunk' | 'line'
            body: string
            side?: 'left' | 'right'
            lineOffsetInHunk?: number
          }>
        }>
      }
  >
}

export function buildSourceControlLlmContext(args: {
  repoRoot: string
  mode: SourceControlLlmContextMode
  diffsByPath: Record<string, GitFileDiff>
  annotationsByPath: Record<string, DiffAnnotation[]>
  selectedFilePath?: string | null
  maxBytes?: number
}): { context: SourceControlLlmContext | null; truncated: boolean; bytes: number } {
  const maxBytes = typeof args.maxBytes === 'number' && args.maxBytes > 0 ? args.maxBytes : 24_000

  if (args.mode === 'none') {
    return { context: null, truncated: false, bytes: 0 }
  }

  const payload: SourceControlLlmContext = {
    kind: 'sourceControl.v1',
    repoRoot: args.repoRoot,
    mode: args.mode,
    generatedAt: Date.now(),
    items: []
  }

  const allPathsSorted = Object.keys(args.diffsByPath).sort()
  const pathsToConsider =
    args.mode === 'selectedFile'
      ? args.selectedFilePath
        ? [args.selectedFilePath]
        : []
      : allPathsSorted

  for (const path of pathsToConsider) {
    const anns = args.annotationsByPath[path] || []

    // annotated-only mode: only include files that actually have annotations
    if (args.mode === 'annotated' && anns.length === 0) continue

    const diff = args.diffsByPath[path]
    if (!diff || !Array.isArray(diff.hunks)) continue

    const fileItem: SourceControlLlmContext['items'][number] = {
      type: 'file',
      path,
      hunks: []
    }

    for (let hunkIndex = 0; hunkIndex < diff.hunks.length; hunkIndex++) {
      const h = diff.hunks[hunkIndex]
      const hunkAnns = anns.filter(a => a.anchor.filePath === path && a.anchor.hunkIndex === hunkIndex)

      // annotated-only mode: skip hunks without annotations
      if (args.mode === 'annotated' && hunkAnns.length === 0) continue

      const lines = (h.lines || []).map(l => l.text)
      const annotations = hunkAnns.map(a => ({
        id: a.id,
        kind: a.anchor.kind,
        body: a.body,
        ...(a.anchor.kind === 'line'
          ? { side: a.anchor.side, lineOffsetInHunk: a.anchor.lineOffsetInHunk }
          : {})
      }))

      fileItem.hunks.push({
        hunkIndex,
        header: h.header,
        lines,
        annotations
      })

      if (!payload.items.some((it) => it.type === 'file' && it.path === path)) {
        payload.items.push(fileItem)
      }

      // Keep deterministic sizing by measuring after each hunk append.
      // If we exceed maxBytes, rollback the last push and stop.
      const nextBytes = byteLenUtf8(JSON.stringify(payload))
      if (nextBytes > maxBytes) {
        // rollback last hunk
        fileItem.hunks.pop()
        // if file has no hunks after rollback, remove it
        if (fileItem.hunks.length === 0) {
          payload.items = payload.items.filter((it) => !(it.type === 'file' && it.path === path))
        }
        const finalBytes = byteLenUtf8(JSON.stringify(payload))
        return { context: payload, truncated: true, bytes: finalBytes }
      }
    }

    // fileItem is pushed lazily above (first included hunk)
  }

  const bytes = byteLenUtf8(JSON.stringify(payload))
  return { context: payload, truncated: false, bytes }
}

function byteLenUtf8(s: string): number {
  // Browser-safe, Node-safe
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s).length
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis as any
  if (g.Buffer) {
    return g.Buffer.byteLength(s, 'utf8')
  }
  // Fallback: approximate (may undercount for non-ascii)
  return s.length
}

