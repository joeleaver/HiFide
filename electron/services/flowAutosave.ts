/**
 * Flow autosave persistence helpers
 *
 * Auto-saves write the currently selected template back to disk so reloading the workspace
 * or switching sessions picks up the latest edits. Unlike the FlowProfileService "save"
 * workflow, autosave snapshots do NOT need to reload the entire template roster.
 */

import type { Node, Edge } from 'reactflow'
import { saveWorkspaceFlowProfile, saveFlowProfile } from './flowProfiles'

export type AutosaveLibrary = 'workspace' | 'user' | 'system'

export interface PersistAutosaveSnapshotOptions {
  workspaceId: string
  templateId: string
  library: AutosaveLibrary
  description?: string
  nodes: Node[]
  edges: Edge[]
}

export type PersistAutosaveResult = 'saved' | 'skipped-system'

export async function persistAutosaveSnapshot(options: PersistAutosaveSnapshotOptions): Promise<PersistAutosaveResult> {
  const { workspaceId, templateId, library, description = '', nodes, edges } = options

  if (library === 'system') {
    // System templates are read-only; treat this as a no-op so callers can log and continue.
    return 'skipped-system'
  }

  if (library === 'workspace') {
    await saveWorkspaceFlowProfile(nodes, edges, templateId, description, workspaceId)
    return 'saved'
  }

  if (library === 'user') {
    await saveFlowProfile(nodes, edges, templateId, description)
    return 'saved'
  }

  // Exhaustiveness guard – TypeScript should prevent reaching this, but throw for safety.
  const unreachable: never = library
  throw new Error(`[flowAutosave] Unsupported library for autosave: ${unreachable}`)
}
