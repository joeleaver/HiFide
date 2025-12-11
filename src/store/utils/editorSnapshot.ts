import type { EditorPersistedState, EditorViewPreference } from './editorPersistence'

export interface EditorSnapshotInput {
  id: string
  path: string
  viewMode?: EditorViewPreference
  isPreview: boolean
  isUntitled?: boolean
}

export function buildEditorPersistenceState(tabs: EditorSnapshotInput[], activeTabId: string | null): EditorPersistedState {
  const persistable = tabs.filter((tab) => !tab.isPreview && !!tab.path && !tab.isUntitled)
  const payloadTabs = persistable.map((tab) => ({ path: tab.path, viewMode: tab.viewMode }))
  const activeTab = activeTabId ? persistable.find((tab) => tab.id === activeTabId) : null

  return {
    tabs: payloadTabs,
    activePath: activeTab ? activeTab.path : null,
  }
}
