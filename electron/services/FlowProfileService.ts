/**
 * Flow Profile Service
 * 
 * Manages flow templates and user-saved profiles.
 * Handles loading, saving, deleting, importing, and exporting flows.
 * 
 * Responsibilities:
 * - Load flow templates from system/user/workspace libraries
 * - Save flow profiles to user/workspace libraries
 * - Delete flow profiles
 * - Import/export flows
 * - Track available templates
 */

import { Service } from './base/Service.js'
import {
  initializeFlowProfiles,
  listFlowTemplates,
  loadFlowTemplate,
  saveFlowProfile,
  saveWorkspaceFlowProfile,
  deleteFlowProfile,
  deleteWorkspaceFlowProfile,
  loadSystemTemplates,
  type FlowTemplate,
  type FlowProfile,
  type FlowLibrary,
} from '../services/flowProfiles.js'
import { dialog } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'

interface WorkspaceFlowProfileState {
  // Available templates for this workspace
  templates: FlowTemplate[]
  systemTemplates: FlowTemplate[]
}

interface FlowProfileState {
  // Map of workspaceId -> workspace-specific state
  workspaces: Record<string, WorkspaceFlowProfileState>

  // UI state for modals (global, not workspace-specific)
  saveAsModalOpen: boolean
  loadTemplateModalOpen: boolean
  newProfileName: string

  // Import/export results (global, not workspace-specific)
  exportResult: { success: boolean; path?: string; error?: string; canceled?: boolean } | null
  importResult: { success: boolean; name?: string; error?: string; canceled?: boolean } | null
}

export class FlowProfileService extends Service<FlowProfileState> {
  constructor() {
    super({
      workspaces: {},
      saveAsModalOpen: false,
      loadTemplateModalOpen: false,
      newProfileName: '',
      exportResult: null,
      importResult: null,
    })
  }

  protected onStateChange(): void {
    // Profile state is transient, no persistence needed
  }

  private getWorkspaceState(workspaceId: string): WorkspaceFlowProfileState {
    if (!this.state.workspaces[workspaceId]) {
      this.state.workspaces[workspaceId] = {
        templates: [],
        systemTemplates: [],
      }
    }
    return this.state.workspaces[workspaceId]
  }

  // Getters
  getTemplates(workspaceId: string): FlowTemplate[] {
    return this.getWorkspaceState(workspaceId).templates
  }

  getSystemTemplates(workspaceId: string): FlowTemplate[] {
    return this.getWorkspaceState(workspaceId).systemTemplates
  }

  getTemplate(workspaceId: string, templateId: string): FlowTemplate | undefined {
    return this.getWorkspaceState(workspaceId).templates.find((t) => t.id === templateId)
  }

  /**
   * Initialize flow profiles for a workspace - load all available templates
   */
  async initializeFor(workspaceId: string): Promise<void> {
    console.log('[FlowProfile] Initializing flow profiles for workspace:', workspaceId)

    try {
      await initializeFlowProfiles()
      const templates = await listFlowTemplates(workspaceId)
      const systemTemplatesRecord = await loadSystemTemplates()

      // Convert Record<string, FlowProfile> to FlowTemplate[]
      const systemTemplates: FlowTemplate[] = Object.entries(systemTemplatesRecord).map(([id, profile]) => ({
        id,
        name: profile.name,
        description: profile.description,
        library: 'system' as FlowLibrary,
        profile,
      }))

      const wsState = this.getWorkspaceState(workspaceId)
      wsState.templates = templates
      wsState.systemTemplates = systemTemplates

      this.setState({ ...this.state })

      console.log('[FlowProfile] Loaded templates for workspace:', workspaceId, {
        total: templates.length,
        system: systemTemplates.length,
      })
    } catch (error) {
      console.error('[FlowProfile] Failed to initialize for workspace:', workspaceId, error)
    }
  }

  /**
   * Reload templates for a workspace (after save/delete/import)
   */
  async reloadTemplatesFor(workspaceId: string): Promise<void> {
    const templates = await listFlowTemplates(workspaceId)
    const systemTemplatesRecord = await loadSystemTemplates()

    // Convert Record<string, FlowProfile> to FlowTemplate[]
    const systemTemplates: FlowTemplate[] = Object.entries(systemTemplatesRecord).map(([id, profile]) => ({
      id,
      name: profile.name,
      description: profile.description,
      library: 'system' as FlowLibrary,
      profile,
    }))

    const wsState = this.getWorkspaceState(workspaceId)
    wsState.templates = templates
    wsState.systemTemplates = systemTemplates

    this.setState({ ...this.state })
  }

  /**
   * Load a flow template
   */
  async loadTemplate(params: { templateId: string }): Promise<{ nodes: any[]; edges: any[] } | null> {
    const { templateId } = params

    console.log('[FlowProfile] Loading template:', templateId)

    try {
      const result = await loadFlowTemplate(templateId)
      return result
    } catch (error) {
      console.error('[FlowProfile] Failed to load template:', error)
      return null
    }
  }

  /**
   * Save current flow as a profile
   */
  async saveProfile(params: {
    workspaceId: string
    name: string
    library: FlowLibrary
    nodes: any[]
    edges: any[]
  }): Promise<void> {
    const { workspaceId, name, library, nodes, edges } = params

    console.log('[FlowProfile] Saving profile:', { workspaceId, name, library })

    try {
      if (library === 'workspace') {
        await saveWorkspaceFlowProfile(nodes, edges, name, '')
      } else {
        await saveFlowProfile(nodes, edges, name, '')
      }

      await this.reloadTemplatesFor(workspaceId)
    } catch (error) {
      console.error('[FlowProfile] Failed to save profile:', error)
      throw error
    }
  }

  /**
   * Delete a flow profile
   */
  async deleteProfile(params: { workspaceId: string; name: string }): Promise<void> {
    const { workspaceId, name } = params

    console.log('[FlowProfile] Deleting profile:', { workspaceId, name })

    try {
      // Try workspace library first, then user library
      try {
        await deleteWorkspaceFlowProfile(name)
      } catch {
        await deleteFlowProfile(name)
      }

      await this.reloadTemplatesFor(workspaceId)
    } catch (error) {
      console.error('[FlowProfile] Failed to delete profile:', error)
      throw error
    }
  }

  /**
   * Export flow to file
   */
  async exportFlow(params: { nodes: any[]; edges: any[] }): Promise<void> {
    const { nodes, edges } = params

    console.log('[FlowProfile] Exporting flow')

    try {
      const result = await dialog.showSaveDialog({
        title: 'Export Flow',
        defaultPath: 'flow.json',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      })

      if (result.canceled || !result.filePath) {
        this.setState({
          exportResult: { success: false, canceled: true },
        })
        return
      }

      const profile: FlowProfile = {
        name: path.basename(result.filePath, '.json'),
        description: '',
        version: '7.0.0',
        nodes,
        edges,
      }

      await fs.writeFile(result.filePath, JSON.stringify(profile, null, 2), 'utf-8')

      this.setState({
        exportResult: { success: true, path: result.filePath },
      })
    } catch (error) {
      console.error('[FlowProfile] Failed to export flow:', error)
      this.setState({
        exportResult: { success: false, error: String(error) },
      })
    }
  }

  /**
   * Import flow from file
   */
  async importFlow(workspaceId: string): Promise<FlowProfile | null> {
    console.log('[FlowProfile] Importing flow for workspace:', workspaceId)

    try {
      const result = await dialog.showOpenDialog({
        title: 'Import Flow',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        properties: ['openFile'],
      })

      if (result.canceled || !result.filePaths.length) {
        this.setState({
          importResult: { success: false, canceled: true },
        })
        return null
      }

      const filePath = result.filePaths[0]
      const content = await fs.readFile(filePath, 'utf-8')
      const profile: FlowProfile = JSON.parse(content)

      // saveFlowProfile expects Node[] and Edge[], but we have SerializedNode[] and SerializedEdge[]
      // We need to deserialize them first using loadFlowTemplate's logic
      // For now, just pass the serialized data and let saveFlowProfile handle it
      // (saveFlowProfile will serialize them again, which is a no-op for already-serialized data)
      await saveFlowProfile(profile.nodes as any, profile.edges as any, profile.name, profile.description || '')
      await this.reloadTemplatesFor(workspaceId)

      this.setState({
        importResult: { success: true, name: profile.name },
      })

      return profile
    } catch (error) {
      console.error('[FlowProfile] Failed to import flow:', error)
      this.setState({
        importResult: { success: false, error: String(error) },
      })
      return null
    }
  }

  /**
   * Clear export result
   */
  clearExportResult(): void {
    this.setState({ exportResult: null })
  }

  /**
   * Clear import result
   */
  clearImportResult(): void {
    this.setState({ importResult: null })
  }

  /**
   * Set save-as modal open state
   */
  setSaveAsModalOpen(params: { open: boolean }): void {
    this.setState({ saveAsModalOpen: params.open })
  }

  /**
   * Set load template modal open state
   */
  setLoadTemplateModalOpen(params: { open: boolean }): void {
    this.setState({ loadTemplateModalOpen: params.open })
  }

  /**
   * Set new profile name
   */
  setNewProfileName(params: { name: string }): void {
    this.setState({ newProfileName: params.name })
  }
}

