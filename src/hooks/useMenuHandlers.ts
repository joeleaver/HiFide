import { useEffect } from 'react'
import { notifications } from '@mantine/notifications'
import { getBackendClient } from '../lib/backend/bootstrap'
import { useUiStore } from '../store/ui'

let handlersRegistered = false

const menuHandlers = {
    openSettings: async () => {
        try { await getBackendClient()?.rpc('view.set', { view: 'settings' }) } catch { }
        try { useUiStore.setState({ currentView: 'settings' }) } catch { }
    },
    openSession: async () => {
        try { await getBackendClient()?.rpc('view.set', { view: 'flow' }) } catch { }
        try { useUiStore.setState({ currentView: 'flow' }) } catch { }
    },
    openFlowEditor: async () => {
        try { await getBackendClient()?.rpc('view.set', { view: 'flow' }) } catch { }
        try { useUiStore.setState({ currentView: 'flow' }) } catch { }
    },
    openKanban: async () => {
        try { await getBackendClient()?.rpc('view.set', { view: 'kanban' }) } catch { }
        try { useUiStore.setState({ currentView: 'kanban' }) } catch { }
    },
    toggleTerminalPanel: async () => {
        try {
            await getBackendClient()?.rpc('ui.toggleWindowState', { key: 'explorerTerminalPanelOpen' })
        } catch (e) {
            // Silently ignore menu toggle errors; user can retry from UI
        }
    },
    openFolder: async () => {
        const client = getBackendClient()
        if (!client) return
        try {
            await client.whenReady(7000)
        } catch { }
        try {
            const result: any = await client.rpc('workspace.openFolderDialog', {})
            if (result?.ok && result.path) {
                await client.rpc('workspace.open', { root: result.path })
                // View will switch to 'flow' on workspace.ready
            }
        } catch (e) {
            // Silently ignore openFolder failures here; StatusBar can reflect workspace state
        }
    },
    openRecentFolder: async (folderPath: string) => {
        const client = getBackendClient()
        if (!client) return
        try {
            await client.whenReady(7000)
        } catch { }
        try {
            await client.rpc('workspace.open', { root: folderPath })
            // View will switch to 'flow' on workspace.ready
        } catch (e) {
            // Silently ignore openRecentFolder failures; user can retry selection
        }
    },
    clearRecentFolders: async () => {
        try { await getBackendClient()?.rpc('workspace.clearRecentFolders', {}) } catch (e) {
            // Silently ignore clearRecentFolders failures
        }
    },
    exportFlow: async () => {
        try {
            const res: any = await getBackendClient()?.rpc('flowEditor.exportFlow', {})
            const result = res?.result
            if (res?.ok && result) {
                if (result.canceled) return
                if (result.success) {
                    notifications.show({ color: 'green', title: 'Exported', message: result.path || 'Flow exported' })
                } else {
                    notifications.show({ color: 'red', title: 'Export failed', message: result.error || 'Unknown error' })
                }
            } else if (res && res.error) {
                notifications.show({ color: 'red', title: 'Export failed', message: String(res.error) })
            }
        } catch (e) {
            notifications.show({ color: 'red', title: 'Export failed', message: String(e) })
        }
    },
    importFlow: async () => {
        try {
            const res: any = await getBackendClient()?.rpc('flowEditor.importFlow', {})
            const result = res?.result
            if (res?.ok && result) {
                if (result.canceled) return
                if (result.success) {
                    notifications.show({ color: 'green', title: 'Imported', message: result.name || 'Flow imported' })
                } else {
                    notifications.show({ color: 'red', title: 'Import failed', message: result.error || 'Unknown error' })
                }
            } else if (res && res.error) {
                notifications.show({ color: 'red', title: 'Import failed', message: String(res.error) })
            }
        } catch (e) {
            notifications.show({ color: 'red', title: 'Import failed', message: String(e) })
        }
    },
}

export function useMenuHandlers() {
    useEffect(() => {
        if (handlersRegistered || !window.menu?.on) return

        window.menu.on('open-settings', menuHandlers.openSettings)
        window.menu.on('open-session', menuHandlers.openSession)
        window.menu.on('open-chat', menuHandlers.openSession)
        window.menu.on('open-flow-editor', menuHandlers.openFlowEditor)
        window.menu.on('open-kanban', menuHandlers.openKanban)
        window.menu.on('toggle-terminal-panel', menuHandlers.toggleTerminalPanel)
        window.menu.on('open-folder', menuHandlers.openFolder)
        window.menu.on('open-recent-folder', menuHandlers.openRecentFolder)
        window.menu.on('clear-recent-folders', menuHandlers.clearRecentFolders)
        window.menu.on('export-flow', menuHandlers.exportFlow)
        window.menu.on('import-flow', menuHandlers.importFlow)

        handlersRegistered = true

        return () => {
            if (!handlersRegistered || !window.menu?.off) return

            window.menu.off('open-settings', menuHandlers.openSettings)
            window.menu.off('open-session', menuHandlers.openSession)
            window.menu.off('open-chat', menuHandlers.openSession)
            window.menu.off('open-flow-editor', menuHandlers.openFlowEditor)
            window.menu.off('open-kanban', menuHandlers.openKanban)
            window.menu.off('toggle-terminal-panel', menuHandlers.toggleTerminalPanel)
            window.menu.off('open-folder', menuHandlers.openFolder)
            window.menu.off('open-recent-folder', menuHandlers.openRecentFolder)
            window.menu.off('clear-recent-folders', menuHandlers.clearRecentFolders)
            window.menu.off('export-flow', menuHandlers.exportFlow)
            window.menu.off('import-flow', menuHandlers.importFlow)

            handlersRegistered = false
        }
    }, [])

    return menuHandlers
}
