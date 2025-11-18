export type FlowLibrary = 'system' | 'user' | 'workspace'

export interface FlowLikeWithLibrary {
  id?: string
  name?: string
  library?: string
}

function normalizeLibrary(library?: string): FlowLibrary {
  if (library === 'system') return 'system'
  if (library === 'workspace') return 'workspace'
  // Treat anything unknown/undefined as user
  return 'user'
}

export function getLibraryLabel(library?: string): 'System' | 'User' | 'Workspace' {
  const normalized = normalizeLibrary(library)
  if (normalized === 'system') return 'System'
  if (normalized === 'workspace') return 'Workspace'
  return 'User'
}

export function splitFlowsByLibrary<T extends { library?: string }>(
  items: readonly T[] | T[]
): { system: T[]; user: T[]; workspace: T[] } {
  const system: T[] = []
  const user: T[] = []
  const workspace: T[] = []

  for (const item of items || []) {
    const lib = normalizeLibrary(item.library)
    if (lib === 'system') system.push(item)
    else if (lib === 'workspace') workspace.push(item)
    else user.push(item)
  }

  return { system, user, workspace }
}

