import type { GitFileDiff } from '../../../shared/git'
import type { DiffAnnotation } from '../../../shared/sourceControlAnnotations'
import type { SourceControlFileGroup, SourceControlFileRow } from '../../components/sourceControl/SourceControlPane'

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

export type SourceControlViewModel = {
  files: SourceControlFileRow[]
  groups: SourceControlFileGroup[]
  activePath: string | null
  activeDiff: GitFileDiff | null
  annotationsForActiveFile: DiffAnnotation[]
}

export function buildSourceControlViewModel(args: {
  changedFiles: Array<{ path: string; statusLabel?: string; staged?: boolean }>
  activePath: string | null
  diffsByPath: Record<string, GitFileDiff | undefined>
  annotations: DiffAnnotation[]
}): SourceControlViewModel {
  const files: SourceControlFileRow[] = args.changedFiles.map((f) => {
    const count = args.annotations.filter((a) => a.anchor.filePath === f.path).length
    return {
      path: f.path,
      label: basename(f.path),
      status: f.statusLabel,
      annotationsCount: count,
    }
  })

  const changedByPath = new Map(args.changedFiles.map((f) => [f.path, f]))
  const stagedFiles = files.filter((f) => changedByPath.get(f.path)?.staged)
  const unstagedFiles = files.filter((f) => !changedByPath.get(f.path)?.staged)

  const groups: SourceControlFileGroup[] = []
  if (stagedFiles.length > 0) groups.push({ id: 'staged', title: `STAGED CHANGES (${stagedFiles.length})`, files: stagedFiles })
  if (unstagedFiles.length > 0) groups.push({ id: 'changes', title: `CHANGES (${unstagedFiles.length})`, files: unstagedFiles })

  const activeDiff = args.activePath ? (args.diffsByPath[args.activePath] ?? null) : null
  const annotationsForActiveFile = args.activePath
    ? args.annotations.filter((a) => a.anchor.filePath === args.activePath)
    : []

  return {
    files,
    groups,
    activePath: args.activePath,
    activeDiff,
    annotationsForActiveFile,
  }
}
