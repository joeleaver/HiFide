/**
 * Flow Profiles IPC Handlers
 * 
 * Manages flow profiles in global user storage using electron-store
 */

import type { IpcMain } from 'electron'
import Store from 'electron-store'

interface FlowProfile {
  name: string
  description: string
  version: string
  nodes: any[]
  edges: any[]
}

// Create a dedicated store for flow profiles
const profilesStore = new Store<Record<string, FlowProfile>>({
  name: 'flow-profiles',
  defaults: {},
})

export function registerFlowProfilesHandlers(ipcMain: IpcMain) {
  /**
   * Get a flow profile by name
   */
  ipcMain.removeHandler('flow-profiles:get')
  ipcMain.handle('flow-profiles:get', async (_e, profileName: string) => {
    try {
      const profile = profilesStore.get(profileName)
      return profile || null
    } catch (error) {
      console.error('[flow-profiles] Failed to get profile:', error)
      return null
    }
  })

  /**
   * Set/save a flow profile
   */
  ipcMain.removeHandler('flow-profiles:set')
  ipcMain.handle('flow-profiles:set', async (_e, profileName: string, profile: FlowProfile) => {
    try {
      profilesStore.set(profileName, profile)
      return { ok: true }
    } catch (error) {
      console.error('[flow-profiles] Failed to set profile:', error)
      return { ok: false, error: String(error) }
    }
  })

  /**
   * List all flow profile names
   */
  ipcMain.removeHandler('flow-profiles:list')
  ipcMain.handle('flow-profiles:list', async () => {
    try {
      const store = profilesStore.store
      const names = Object.keys(store)
      return names
    } catch (error) {
      console.error('[flow-profiles] Failed to list profiles:', error)
      return []
    }
  })

  /**
   * Delete a flow profile
   */
  ipcMain.removeHandler('flow-profiles:delete')
  ipcMain.handle('flow-profiles:delete', async (_e, profileName: string) => {
    try {
      profilesStore.delete(profileName)
      return { ok: true }
    } catch (error) {
      console.error('[flow-profiles] Failed to delete profile:', error)
      return { ok: false, error: String(error) }
    }
  })

  /**
   * Check if a profile exists
   */
  ipcMain.removeHandler('flow-profiles:has')
  ipcMain.handle('flow-profiles:has', async (_e, profileName: string) => {
    try {
      return profilesStore.has(profileName)
    } catch (error) {
      console.error('[flow-profiles] Failed to check profile:', error)
      return false
    }
  })
}

