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
  isSystemTemplate,
  loadSystemTemplates,
  type FlowTemplate,
  type FlowProfile,
  type FlowLibrary,
} from '../services/flowProfiles.js'
import { dialog } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'

interface FlowProfileState {
  // Available templates
  templates: FlowTemplate[]
  systemTemplates: FlowTemplate[]
  
  // UI state for modals
  selectedTemplateId: string | null
  saveAsModalOpen: boolean
  loadTemplateModalOpen: boolean
  newProfileName: string
  
  // Import/export results
  exportResult: { success: boolean; path?: string; error?: string; canceled?: boolean } | null
  importResult: { success: boolean; name?: string; error?: string; canceled?: boolean } | null
}

export class FlowProfileService extends Service<FlowProfileState> {
  constructor() {
    super({
      templates: [],
      systemTemplates: [],
      selectedTemplateId: null,
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

  // Getters
  getTemplates(): FlowTemplate[] {
    return this.state.templates
  }

  getSystemTemplates(): FlowTemplate[] {
    return this.state.systemTemplates
  }

  getSelectedTemplateId(): string | null {
    return this.state.selectedTemplateId
  }

  getTemplate(templateId: string): FlowTemplate | undefined {
    return this.state.templates.find((t) => t.id === templateId)
  }

  /**
   * Initialize flow profiles - load all available templates
   */
  async initialize(): Promise<void> {
    console.log('[FlowProfile] Initializing flow profiles')

    try {
      await initializeFlowProfiles()
      const templates = await listFlowTemplates()
      const systemTemplates = await loadSystemTemplates()

      this.setState({
        templates,
        systemTemplates,
      })

      console.log('[FlowProfile] Loaded templates:', {
        total: templates.length,
        system: systemTemplates.length,
      })
    } catch (error) {
      console.error('[FlowProfile] Failed to initialize:', error)
    }
  }

  /**
   * Reload templates (after save/delete/import)
   */
  async reloadTemplates(): Promise<void> {
    const templates = await listFlowTemplates()
    const systemTemplates = await loadSystemTemplates()

    this.setState({
      templates,
      systemTemplates,
    })
  }

  /**
   * Load a flow template
   */
  async loadTemplate(params: { templateId: string }): Promise<FlowProfile | null> {
    const { templateId } = params

    console.log('[FlowProfile] Loading template:', templateId)

    try {
      const profile = await loadFlowTemplate(templateId)
      return profile
    } catch (error) {
      console.error('[FlowProfile] Failed to load template:', error)
      return null
    }
  }

  /**
   * Save current flow as a profile
   */
  async saveProfile(params: {
    name: string
    library: FlowLibrary
    nodes: any[]
    edges: any[]
  }): Promise<void> {
    const { name, library, nodes, edges } = params

    console.log('[FlowProfile] Saving profile:', { name, library })

    try {
      const profile: FlowProfile = {
        name,
        nodes,
        edges,
      }

      if (library === 'workspace') {
        await saveWorkspaceFlowProfile(name, profile)
      } else {
        await saveFlowProfile(name, profile)
      }

      await this.reloadTemplates()
    } catch (error) {
      console.error('[FlowProfile] Failed to save profile:', error)
      throw error
    }
  }

  /**
   * Delete a flow profile
   */
  async deleteProfile(params: { name: string }): Promise<void> {
    const { name } = params

    console.log('[FlowProfile] Deleting profile:', name)

    try {
      // Try workspace library first, then user library
      try {
        await deleteWorkspaceFlowProfile(name)
      } catch {
        await deleteFlowProfile(name)
      }

      await this.reloadTemplates()
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
  async importFlow(): Promise<FlowProfile | null> {
    console.log('[FlowProfile] Importing flow')

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

      // Save to user library
      await saveFlowProfile(profile.name, profile)
      await this.reloadTemplates()

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
   * Set selected template
   */
  setSelectedTemplate(params: { id: string }): void {
    this.setState({ selectedTemplateId: params.id })
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

