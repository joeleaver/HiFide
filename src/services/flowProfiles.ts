/**
 * Flow Profiles Service
 *
 * Manages flow profiles with two-tier system:
 * - System Library: Read-only bundled templates (shipped with app)
 * - User Library: User-created/modified profiles (stored in electron-store)
 */

import type { Node, Edge } from 'reactflow'
import defaultFlowProfile from '../profiles/default-flow.json'

/**
 * Minimal node data for serialization - only essential fields
 */
export interface SerializedNode {
  id: string
  kind: string
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

/**
 * Serialize a ReactFlow node to minimal format for storage
 */
function serializeNode(node: Node): SerializedNode {
  const data = node.data as any
  return {
    id: node.id,
    kind: data?.kind || node.id.split('-')[0],
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
  return {
    id: serialized.id,
    type: 'hifiNode',
    position: serialized.position,
    data: {
      kind: serialized.kind,
      label: serialized.id,
      labelBase: serialized.id,
      config: serialized.config || {},
      expanded: serialized.expanded || false,
      bp: false,
      onToggleBp: () => {}, // Will be set by store
    },
  }
}

/**
 * Deserialize a stored edge to ReactFlow format
 * Note: Styling (type, color, markerEnd) is added by the FlowCanvasPanel's styledEdges memo
 * and defaultEdgeOptions, so we only need to restore the essential connection data
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

const DEFAULT_PROFILE_NAME = 'default'

// System library - bundled templates (read-only)
const SYSTEM_TEMPLATES: Record<string, FlowProfile> = {
  'default': defaultFlowProfile as FlowProfile,
}

/**
 * Get the flow profiles store (managed by main process)
 */
function getProfilesStore() {
  return (window as any).flowProfiles
}

/**
 * Check if a template ID is from the system library
 */
export function isSystemTemplate(id: string): boolean {
  return id in SYSTEM_TEMPLATES
}

/**
 * Load a flow template by ID (checks system library first, then user library)
 * Returns deserialized nodes and edges ready for ReactFlow
 */
export async function loadFlowTemplate(id: string): Promise<{ nodes: Node[]; edges: Edge[] } | null> {
  try {
    let profile: FlowProfile | null = null

    // Check system library first
    if (SYSTEM_TEMPLATES[id]) {
      profile = SYSTEM_TEMPLATES[id]
    } else {
      // Check user library
      const store = getProfilesStore()
      if (!store) return null
      profile = await store.get(id)
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
    if (isSystemTemplate(profileName)) {
      return {
        success: false,
        error: `Cannot overwrite system template "${profileName}". Please use a different name.`
      }
    }

    const store = getProfilesStore()
    if (!store) {
      return { success: false, error: 'Profile store not available' }
    }

    // Serialize nodes and edges to minimal format
    const profile: FlowProfile = {
      name: profileName,
      description,
      version: '7.0.0',
      nodes: nodes.map(serializeNode),
      edges: edges.map(serializeEdge),
    }

    await store.set(profileName, profile)
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
    if (isSystemTemplate(profileName)) {
      return {
        success: false,
        error: `Cannot delete system template "${profileName}".`
      }
    }

    const store = getProfilesStore()
    if (!store) {
      return { success: false, error: 'Profile store not available' }
    }

    await store.delete(profileName)
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

    // Add system templates
    for (const [id, profile] of Object.entries(SYSTEM_TEMPLATES)) {
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
    const store = getProfilesStore()
    if (store) {
      const userProfiles = await store.list()
      for (const profileName of userProfiles) {
        // Skip if this ID is already used by a system template
        if (seenIds.has(profileName)) {
          console.warn(`Skipping user profile "${profileName}" - conflicts with system template`)
          continue
        }

        const profile = await store.get(profileName)
        if (profile) {
          templates.push({
            id: profileName,
            name: profile.name,
            description: profile.description,
            library: 'user',
            profile
          })
          seenIds.add(profileName)
        }
      }
    }

    return templates
  } catch (error) {
    console.error('Failed to list flow templates:', error)
    return []
  }
}

export async function listFlowProfiles(): Promise<string[]> {
  const templates = await listFlowTemplates()
  return templates.map(t => t.id)
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

