/**
 * Flow Profiles Service (Main Process)
 *
 * Manages flow profiles with two-tier system:
 * - System Library: Read-only bundled templates (shipped with app)
 * - User Library: User-created/modified profiles (stored in electron-store)
 *
 * This is the main process version that works directly with electron-store
 */

import Store from 'electron-store'
import type { Node, Edge } from 'reactflow'
import * as path from 'path'
import * as fs from 'fs/promises'

/**
 * Minimal node data for serialization - only essential fields
 */
export interface SerializedNode {
  id: string
  kind: string
  label?: string      // Custom node label (if different from id)
  config?: Record<string, any>
  position: { x: number; y: number }
  expanded?: boolean  // Only layout info we persist
}

/**
 * Minimal edge data for serialization - only essential fields
 */
export interface SerializedEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export interface FlowProfile {
  name: string
  description: string
  version: string
  nodes: SerializedNode[]
  edges: SerializedEdge[]
}

export interface FlowTemplate {
  id: string
  name: string
  description: string
  library: 'system' | 'user'
  profile: FlowProfile
}

// Create a dedicated store for flow profiles
const profilesStore = new Store<Record<string, FlowProfile>>({
  name: 'flow-profiles',
  defaults: {},
})

/**
 * Serialize a ReactFlow node to minimal format for storage
 */
function serializeNode(node: Node): SerializedNode {
  const data = node.data as any
  const label = data?.labelBase || data?.label

  return {
    id: node.id,
    kind: data?.kind || node.id.split('-')[0],
    label: label !== node.id ? label : undefined, // Only save if different from id
    config: data?.config || {},
    position: node.position,
    expanded: data?.expanded || false,
  }
}

/**
 * Serialize a ReactFlow edge to minimal format for storage
 */
function serializeEdge(edge: Edge): SerializedEdge {
  return {
    id: edge.id || `${edge.source}-${edge.target}`,
    source: edge.source,
    target: edge.target,
    sourceHandle: (edge as any)?.sourceHandle,
    targetHandle: (edge as any)?.targetHandle,
  }
}

/**
 * Deserialize a stored node to ReactFlow format
 */
function deserializeNode(serialized: SerializedNode): Node {
  const label = serialized.label || serialized.id

  return {
    id: serialized.id,
    type: 'hifiNode',
    position: serialized.position,
    data: {
      kind: serialized.kind,
      label: label,
      labelBase: label,
      config: serialized.config || {},
      expanded: serialized.expanded || false,
      bp: false,
      onToggleBp: () => {}, // Will be set by store
    },
  }
}

/**
 * Deserialize a stored edge to ReactFlow format
 */
function deserializeEdge(serialized: SerializedEdge): Edge {
  return {
    id: serialized.id,
    source: serialized.source,
    target: serialized.target,
    sourceHandle: serialized.sourceHandle,
    targetHandle: serialized.targetHandle,
  }
}

// Cache for system templates
let systemTemplates: Record<string, FlowProfile> | null = null

const DEFAULT_PROFILE_NAME = 'default'

/**
 * Get the system templates directory path
 */
function getSystemTemplatesDir(): string {
  const isDev = process.env.NODE_ENV === 'development'
  return isDev
    ? path.join(process.cwd(), 'src', 'profiles')
    : path.join(process.resourcesPath, 'app.asar', 'dist', 'profiles')
}

/**
 * Load all system templates from the profiles directory
 * Scans for all .json files and loads them as templates
 */
export async function loadSystemTemplates(): Promise<Record<string, FlowProfile>> {
  if (systemTemplates) {
    return systemTemplates
  }

  systemTemplates = {}

  try {
    const templatesDir = getSystemTemplatesDir()

    const files = await fs.readdir(templatesDir)

    for (const file of files) {
      if (!file.endsWith('.json')) continue

      try {
        const filePath = path.join(templatesDir, file)
        const content = await fs.readFile(filePath, 'utf-8')
        const profile = JSON.parse(content) as FlowProfile

        // Use the profile's name as the ID, or fall back to filename without extension
        const id = profile.name || path.basename(file, '.json')
        systemTemplates[id] = profile

      } catch (error) {
        console.error(`[flowProfiles] Failed to load template ${file}:`, error)
      }
    }

  } catch (error) {
    console.error('[flowProfiles] Failed to load system templates:', error)
  }

  return systemTemplates
}

/**
 * Check if a template ID is from the system library
 */
export async function isSystemTemplate(id: string): Promise<boolean> {
  const templates = await loadSystemTemplates()
  return id in templates
}

/**
 * Load a flow template by ID (checks system library first, then user library)
 * Returns deserialized nodes and edges ready for ReactFlow
 */
export async function loadFlowTemplate(id: string): Promise<{ nodes: Node[]; edges: Edge[] } | null> {
  try {
    let profile: FlowProfile | null = null

    // Check system library first
    const systemTemplates = await loadSystemTemplates()
    if (systemTemplates[id]) {
      profile = systemTemplates[id]
    } else {
      // Check user library
      profile = profilesStore.get(id) || null
    }

    if (!profile) return null

    // Deserialize nodes and edges
    const nodes = profile.nodes.map(deserializeNode)
    const edges = profile.edges.map(deserializeEdge)

    return { nodes, edges }
  } catch (error) {
    console.error('Failed to load flow template:', error)
    return null
  }
}

/**
 * Save a flow profile to user library
 * Note: Cannot save to system library (read-only)
 */
export async function saveFlowProfile(
  nodes: Node[],
  edges: Edge[],
  profileName: string,
  description: string = ''
): Promise<{ success: boolean; error?: string }> {
  try {
    // Prevent overwriting system templates
    const isSystem = await isSystemTemplate(profileName)
    if (isSystem) {
      return {
        success: false,
        error: `Cannot overwrite system template "${profileName}". Please use a different name.`
      }
    }

    // Serialize nodes and edges to minimal format
    const profile: FlowProfile = {
      name: profileName,
      description,
      version: '7.0.0',
      nodes: nodes.map(serializeNode),
      edges: edges.map(serializeEdge),
    }

    profilesStore.set(profileName, profile)
    return { success: true }
  } catch (error) {
    console.error('Failed to save flow profile:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Delete a flow profile from user library
 * Note: Cannot delete system templates (read-only)
 */
export async function deleteFlowProfile(
  profileName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Prevent deleting system templates
    const isSystem = await isSystemTemplate(profileName)
    if (isSystem) {
      return {
        success: false,
        error: `Cannot delete system template "${profileName}".`
      }
    }

    profilesStore.delete(profileName)
    return { success: true }
  } catch (error) {
    console.error('Failed to delete flow profile:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * List all available flow templates (system + user)
 */
export async function listFlowTemplates(): Promise<FlowTemplate[]> {
  try {
    const templates: FlowTemplate[] = []
    const seenIds = new Set<string>()

    // Add all system templates
    const systemTemplates = await loadSystemTemplates()
    for (const [id, profile] of Object.entries(systemTemplates)) {
      templates.push({
        id,
        name: profile.name,
        description: profile.description,
        library: 'system',
        profile
      })
      seenIds.add(id)
    }

    // Add user templates (skip if ID conflicts with system template)
    const store = profilesStore.store
    for (const [profileName, profile] of Object.entries(store)) {
      // Skip if this ID is already used by a system template
      if (seenIds.has(profileName)) {
        continue
      }

      templates.push({
        id: profileName,
        name: profile.name,
        description: profile.description,
        library: 'user',
        profile
      })
      seenIds.add(profileName)
    }

    return templates
  } catch (error) {
    console.error('Failed to list flow templates:', error)
    return []
  }
}

/**
 * Initialize flow profiles system
 * - System templates are always available (read-only)
 * - Returns the default system template as deserialized nodes/edges
 */
export async function initializeFlowProfiles(): Promise<{ nodes: Node[]; edges: Edge[] } | null> {
  try {
    // Load and deserialize the default template
    return loadFlowTemplate(DEFAULT_PROFILE_NAME)
  } catch (error) {
    console.error('Failed to initialize flow profiles:', error)
    return loadFlowTemplate(DEFAULT_PROFILE_NAME)
  }
}

