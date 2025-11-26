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
  nodeType: string    // The actual node type (e.g., 'llmRequest', 'userInput')
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

export type FlowLibrary = 'system' | 'user' | 'workspace'

export interface FlowTemplate {
  id: string
  name: string
  description: string
  library: FlowLibrary
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
    nodeType: data?.nodeType || node.id.split('-')[0],
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
      nodeType: serialized.nodeType,
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

// Cache for workspace templates, keyed by absolute workspace root
const workspaceTemplatesCache = new Map<string, Record<string, FlowProfile>>()

async function getWorkspaceRoot(): Promise<string> {
  const { resolveWorkspaceRootAsync } = await import('../utils/workspace.js')
  return resolveWorkspaceRootAsync()
}

async function loadWorkspaceTemplates(): Promise<Record<string, FlowProfile>> {
  const root = await getWorkspaceRoot()
  const absRoot = path.resolve(root)

  const cached = workspaceTemplatesCache.get(absRoot)
  if (cached) return cached

  const templates: Record<string, FlowProfile> = {}
  const flowsDir = path.join(absRoot, '.hifide-public', 'flows')

  try {
    const files = await fs.readdir(flowsDir)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const filePath = path.join(flowsDir, file)
        const content = await fs.readFile(filePath, 'utf-8')
        const profile = JSON.parse(content) as FlowProfile
        const id = profile.name || path.basename(file, '.json')
        templates[id] = profile
      } catch (error) {
        console.error(`[flowProfiles] Failed to load workspace flow ${file}:`, error)
      }
    }
  } catch (error: any) {
    if (error && (error as any).code !== 'ENOENT') {
      console.error('[flowProfiles] Failed to read workspace flows directory:', error)
    }
  }

  workspaceTemplatesCache.set(absRoot, templates)
  return templates
}



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
 * Load a flow template by ID.
 * Checks libraries in order: system -> workspace -> user.
 * Returns deserialized nodes and edges ready for ReactFlow.
 */
export async function loadFlowTemplate(id: string): Promise<{ nodes: Node[]; edges: Edge[] } | null> {
  try {
    let rawProfile: any = null

    // Check system library first
    const systemTemplates = await loadSystemTemplates()
    if (systemTemplates[id]) {
      rawProfile = systemTemplates[id]
    } else {
      // Then check workspace library (per-workspace flows)
      try {
        const workspaceTemplates = await loadWorkspaceTemplates()
        if (workspaceTemplates[id]) {
          rawProfile = workspaceTemplates[id]
        } else {
          // Finally check user library
          rawProfile = profilesStore.get(id) || null
        }
      } catch {
        // If workspace templates fail to load, still fall back to user library
        rawProfile = profilesStore.get(id) || null
      }
    }

    if (!rawProfile || typeof rawProfile !== 'object') return null

    // Sanitize profile structure defensively to avoid crashes on bad saves
    const nodesArr = Array.isArray(rawProfile.nodes) ? rawProfile.nodes : []
    const edgesArr = Array.isArray(rawProfile.edges) ? rawProfile.edges : []

    const safeNodes = nodesArr
      .filter((n: any) => n && typeof n.id === 'string' && typeof n.nodeType === 'string' && n.position && typeof n.position.x === 'number' && typeof n.position.y === 'number')
      .map((n: any) => ({
        id: n.id,
        nodeType: n.nodeType,
        label: typeof n.label === 'string' ? n.label : undefined,
        config: (n.config && typeof n.config === 'object') ? n.config : {},
        position: { x: Number(n.position.x) || 0, y: Number(n.position.y) || 0 },
        expanded: !!n.expanded,
      })) as SerializedNode[]

    const safeEdges = edgesArr
      .filter((e: any) => e && typeof e.source === 'string' && typeof e.target === 'string')
      .map((e: any) => ({
        id: typeof e.id === 'string' ? e.id : `${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        sourceHandle: typeof e.sourceHandle === 'string' ? e.sourceHandle : undefined,
        targetHandle: typeof e.targetHandle === 'string' ? e.targetHandle : undefined,
      })) as SerializedEdge[]

    const profile: FlowProfile = {
      name: typeof rawProfile.name === 'string' ? rawProfile.name : id,
      description: typeof rawProfile.description === 'string' ? rawProfile.description : '',
      version: typeof rawProfile.version === 'string' ? rawProfile.version : '7.0.0',
      nodes: safeNodes,
      edges: safeEdges,
    }

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
 * Save a flow profile to the current workspace library (.hifide-public/flows).
 * Note: Cannot save using a name that conflicts with a system template.
 */
export async function saveWorkspaceFlowProfile(
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
        error: `Cannot overwrite system template "${profileName}". Please use a different name.`,
      }
    }

    const root = await getWorkspaceRoot()
    const absRoot = path.resolve(root)
    const flowsDir = path.join(absRoot, '.hifide-public', 'flows')

    await fs.mkdir(flowsDir, { recursive: true })

    const profile: FlowProfile = {
      name: profileName,
      description,
      version: '7.0.0',
      nodes: nodes.map(serializeNode),
      edges: edges.map(serializeEdge),
    }

    const filePath = path.join(flowsDir, `${profileName}.json`)
    await fs.writeFile(filePath, JSON.stringify(profile, null, 2), 'utf-8')

    // Update workspace templates cache for this root
    const existing = workspaceTemplatesCache.get(absRoot) || {}
    workspaceTemplatesCache.set(absRoot, { ...existing, [profileName]: profile })

    return { success: true }
  } catch (error) {
    console.error('Failed to save workspace flow profile:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Delete a flow profile from the current workspace library (.hifide-public/flows).
 * Note: Cannot delete system templates.
 */
export async function deleteWorkspaceFlowProfile(
  profileName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const isSystem = await isSystemTemplate(profileName)
    if (isSystem) {
      return {
        success: false,
        error: `Cannot delete system template "${profileName}".`,
      }
    }

    const root = await getWorkspaceRoot()
    const absRoot = path.resolve(root)
    const flowsDir = path.join(absRoot, '.hifide-public', 'flows')
    const filePath = path.join(flowsDir, `${profileName}.json`)

    try {
      await fs.unlink(filePath)
    } catch (error: any) {
      if (!error || (error as any).code !== 'ENOENT') {
        throw error
      }
    }

    // Update workspace templates cache for this root
    const existing = workspaceTemplatesCache.get(absRoot)
    if (existing) {
      const next = { ...existing }
      delete (next as any)[profileName]
      workspaceTemplatesCache.set(absRoot, next)
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to delete workspace flow profile:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
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
 * List all available flow templates (system + workspace + user)
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
        profile,
      })
      seenIds.add(id)
    }

    // Add workspace templates (per-workspace library)
    try {
      const workspaceTemplates = await loadWorkspaceTemplates()
      for (const [id, profile] of Object.entries(workspaceTemplates)) {
        if (seenIds.has(id)) continue
        templates.push({
          id,
          name: profile.name,
          description: profile.description,
          library: 'workspace',
          profile,
        })
        seenIds.add(id)
      }
    } catch (error) {
      console.error('Failed to list workspace flow templates:', error)
    }

    // Add user templates (skip if ID conflicts with system or workspace template)
    const store = profilesStore.store
    for (const [profileName, profile] of Object.entries(store)) {
      if (seenIds.has(profileName)) {
        continue
      }

      templates.push({
        id: profileName,
        name: profile.name,
        description: profile.description,
        library: 'user',
        profile,
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

