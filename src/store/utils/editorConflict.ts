import type { ExplorerFsEvent } from '../../../electron/store/types'

export interface TabFsSnapshot {
  mtimeMs?: number
  lastLoadedAt?: number
}

function getTabTimestamp(tab: TabFsSnapshot): number {
  return tab.mtimeMs ?? tab.lastLoadedAt ?? 0
}

function getEventTimestamp(event: ExplorerFsEvent): number {
  return event.mtimeMs ?? event.updatedAt
}

export function shouldReloadTabFromEvent(tab: TabFsSnapshot, event: ExplorerFsEvent): boolean {
  if (event.isDirectory) return false
  if (event.kind !== 'file-updated' && event.kind !== 'file-added') return false

  const eventTs = getEventTimestamp(event)
  const tabTs = getTabTimestamp(tab)
  if (eventTs && tabTs && eventTs <= tabTs) {
    return false
  }

  return true
}
