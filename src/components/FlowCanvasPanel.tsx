import { useRef, useMemo, useCallback, useState, useEffect } from 'react'
import ReactFlow, {
  Background,
  Controls,
  ControlButton,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type Node as FlowNode,
  type Edge,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { getBackendClient } from '../lib/backend/bootstrap'
import { useFlowEditorLocal } from '../store/flowEditorLocal'
import { useRerenderTrace } from '../utils/perf'
import { splitFlowsByLibrary, getLibraryLabel } from '../utils/flowLibraries'
import { useFlowRuntime } from '../store/flowRuntime'


import { Button, Group, Badge, TextInput, Modal, Text, Menu } from '@mantine/core'
import { IconLayoutDistributeVertical, IconChevronDown, IconChevronRight, IconPlus, IconCopy, IconTrash } from '@tabler/icons-react'
import FlowNodeComponent from './FlowNode'
import { useUiStore } from '../store/ui'
import { getLayoutedElements } from '../utils/autoLayout'
import { getNodeColor } from '../../shared/node-colors'
import { getConnectionColorFromHandles, CONNECTION_COLORS } from '../../shared/connection-colors'

import { notifications } from '@mantine/notifications'

const nodeTypes = { hifiNode: FlowNodeComponent }

// Node palette definitions (excludes defaultContextStart - always present, can't be added/removed)
const NODE_PALETTE: Array<{ nodeType: string; label: string; icon: string; description: string }> = [
  { nodeType: 'userInput', label: 'User Input', icon: '👤', description: 'Accept user input (entry point or pause mid-flow)' },
  { nodeType: 'manualInput', label: 'Manual Input', icon: '✍️', description: 'Send pre-configured user message mid-flow' },
  { nodeType: 'newContext', label: 'New Context', icon: '🔀', description: 'Create new execution context with different model/provider' },
  { nodeType: 'llmRequest', label: 'LLM Request', icon: '💬', description: 'Send a request to the LLM' },
  { nodeType: 'tools', label: 'Tools', icon: '🔧', description: 'Provide tools to LLM (auto or specific list)' },
  { nodeType: 'injectMessages', label: 'Inject Messages', icon: '💉', description: 'Inject user/assistant message pair into conversation history' },
  { nodeType: 'intentRouter', label: 'Intent Router', icon: '🔀', description: 'Route based on LLM-classified user intent' },
  { nodeType: 'portalInput', label: 'Portal In', icon: '📥', description: 'Store data for portal output (reduces edge crossings)' },
  { nodeType: 'portalOutput', label: 'Portal Out', icon: '📤', description: 'Retrieve data from portal input (reduces edge crossings)' },
  { nodeType: 'parallelSplit', label: 'Split', icon: '⑂', description: 'Split flow into two parallel branches' },
  { nodeType: 'parallelJoin', label: 'Merge', icon: '🔗', description: 'Merge multiple inputs into one output' },
  { nodeType: 'cache', label: 'Cache', icon: '💾', description: 'Cache data to avoid re-executing expensive operations' },
  { nodeType: 'redactor', label: 'Redactor', icon: '🧹', description: 'Redact sensitive data' },
  { nodeType: 'budgetGuard', label: 'Budget Guard', icon: '💰', description: 'Monitor token budget' },
  { nodeType: 'errorDetection', label: 'Error Detection', icon: '⚠️', description: 'Detect error patterns' },
  { nodeType: 'approvalGate', label: 'Approval Gate', icon: '✅', description: 'Require manual approval' },
]




interface FlowCanvasPanelProps {}

export default function FlowCanvasPanel({}: FlowCanvasPanelProps) {
  const rfRef = useRef<any>(null)
  const reactFlowInstance = useReactFlow()


  // ===== LOCAL STATE (Instant UI Updates - Renderer-only store) =====
  // Nodes and edges are kept in a renderer-local zustand store for responsiveness
  // They are debounced-synced to the main store
  const localNodes = useFlowEditorLocal((s) => s.nodes) as FlowNode[]
  const setLocalNodes = useFlowEditorLocal((s) => s.setNodes)
  const localEdges = useFlowEditorLocal((s) => s.edges) as Edge[]
  const setLocalEdges = useFlowEditorLocal((s) => s.setEdges)
  const hydrateFromMain = useFlowEditorLocal((s) => s.hydrateFromMain)

  // ===== REMOTE STATE (Execution & Persistence) =====
  // Execution state (metadata only) - subscribe manually to avoid ref-only rerenders from IPC
  const runtimeNodeStateRef = useRef<Record<string, any>>({})
  const [nodeStateSig, setNodeStateSig] = useState<string>('')
  useEffect(() => {
    let prevSig = ''
    const mkSig = (ns: any) => {
      try {
        return JSON.stringify(
          Object.entries(ns || {})
            .sort(([a],[b]) => a.localeCompare(b))
            .map(([id, v]: any) => ({ id, st: v?.status, ch: v?.cacheHit, dm: v?.durationMs, c: v?.costUSD, sb: v?.style?.border, ss: v?.style?.boxShadow }))
        )
      } catch {
        return ''
      }
    }
    // Seed from current runtime state
    const s = (useFlowRuntime as any).getState()
    runtimeNodeStateRef.current = s?.nodeState || {}
    prevSig = mkSig(runtimeNodeStateRef.current)
    setNodeStateSig(prevSig)
    // Subscribe to runtime changes
    const unsub = (useFlowRuntime as any).subscribe((next: any) => {
      const ns = next?.nodeState || {}
      const sig = mkSig(ns)
      if (sig !== prevSig) {
        runtimeNodeStateRef.current = ns
        prevSig = sig
        setNodeStateSig(sig)
      }
    })
    return () => unsub?.()
  }, [])
  const status = useFlowRuntime((s: any) => s.status)
  const pausedNode = useFlowRuntime((s: any) => s.pausedNode)
  const [availableTemplates, setAvailableTemplates] = useState<any[]>([])
  const [templatesLoaded, setTemplatesLoaded] = useState<boolean>(false)
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false)

  // Helper to check if a template is from system library
  const isSystemTemplate = useCallback((templateId: string) => {
    const template = availableTemplates.find((t: any) => t.id === templateId)
    return template?.library === 'system'
  }, [availableTemplates])
  const [saveAsModalOpen, setSaveAsModalOpen] = useState<boolean>(false)
  const [loadTemplateModalOpen, setLoadTemplateModalOpen] = useState<boolean>(false)
  const [pendingSelection, setPendingSelection] = useState<string | null>(null)

  // Use local state for profile name input to avoid lag on every keystroke
  const [localProfileName, setLocalProfileName] = useState('')
  const [saveAsLibrary, setSaveAsLibrary] = useState<'workspace' | 'user'>('workspace')

  // New Flow modal state (renderer-only UI store)
  const newFlowModalOpen = useUiStore((s) => s.newFlowModalOpen)
  const newFlowName = useUiStore((s) => s.newFlowName)
  const newFlowError = useUiStore((s) => s.newFlowError)
  const setNewFlowModalOpen = useUiStore((s) => s.setNewFlowModalOpen)
  const setNewFlowName = useUiStore((s) => s.setNewFlowName)
  const setNewFlowError = useUiStore((s) => s.setNewFlowError)
  const resetNewFlowModal = useUiStore((s) => s.resetNewFlowModal)

  // Flow template library groups for editor selector
  const [templateFilter, setTemplateFilter] = useState('')
  const allTemplates = Array.isArray(availableTemplates) ? availableTemplates : []
  const { system: systemTemplates, user: userTemplates, workspace: workspaceTemplates } = splitFlowsByLibrary(allTemplates as any[])

  // No useEffect needed - templates are loaded by initFlowEditor in the store

  // Handle profile/template selection - auto-load when selected
  const handleSelectionChange = useCallback(async (value: string | null) => {
    if (!value) return

    if (hasUnsavedChanges) {
      setPendingSelection(value)
      setLoadTemplateModalOpen(true)
      return
    }

    const client = getBackendClient()
    try {
      const res: any = await client?.rpc('flowEditor.loadTemplate', { templateId: value })
      if (res?.ok) {
        // Refresh meta + graph
        const t: any = await client?.rpc('flowEditor.getTemplates', {})
        if (t?.ok) {
          setAvailableTemplates(t.templates || [])
          setTemplatesLoaded(!!t.templatesLoaded)
          setSelectedTemplate(t.selectedTemplate || value)
        }
        const g: any = await client?.rpc('flowEditor.getGraph', {})
        if (g?.ok) {
          const nodes = Array.isArray(g.nodes) ? g.nodes : []
          const edges = Array.isArray(g.edges) ? g.edges : []
          const styledNodes = nodes.map((n: any) => ({ ...n, data: { ...(n.data || {}), __runtime: runtimeNodeStateRef.current?.[n.id] || null } }))
          hydrateFromMain({ nodes: styledNodes, edges })
          const nSig = JSON.stringify({ n: nodes.map((x: any) => ({ id: x?.id, p: x?.position, t: x?.data?.nodeType, l: x?.data?.labelBase ?? x?.data?.label, c: x?.data?.config ?? null })), e: edges.map((x: any) => ({ id: x?.id, s: x?.source, t: x?.target, sh: (x as any)?.sourceHandle ?? undefined, th: (x as any)?.targetHandle ?? undefined })) })
          ;(lastLoadedTemplateRef as any).currentSig = nSig
          lastSyncedSigRef.current = nSig
          setHasUnsavedChanges(false)
        }
      }
    } catch {}
  }, [hasUnsavedChanges, hydrateFromMain])

  // Handle save as (create new profile)
  const handleSaveAs = useCallback(async () => {
    if (!localProfileName.trim()) return
    const name = localProfileName.trim()
    const client = getBackendClient()
    try {
      // Sync local state to backend before saving
      await client?.rpc('flowEditor.setGraph', { nodes: localNodes, edges: localEdges })
      const res: any = await client?.rpc('flowEditor.saveAsProfile', { name, library: saveAsLibrary })
      if (res?.ok) {
        setLocalProfileName('')
        setSaveAsModalOpen(false)
        // Refresh templates/meta
        const t: any = await client?.rpc('flowEditor.getTemplates', {})
        if (t?.ok) {
          setAvailableTemplates(t.templates || [])
          setTemplatesLoaded(!!t.templatesLoaded)
          setSelectedTemplate(t.selectedTemplate || name)
        }
        // After save, update last loaded signature using current local graph
        try {
          const n = (localNodes || []).map((x: any) => ({ id: x?.id, p: x?.position, t: x?.data?.nodeType, l: x?.data?.labelBase ?? x?.data?.label, c: x?.data?.config ?? null }))
          const e = (localEdges || []).map((x: any) => ({ id: x?.id, s: x?.source, t: x?.target, sh: (x as any)?.sourceHandle ?? undefined, th: (x as any)?.targetHandle ?? undefined }))
          const sig = JSON.stringify({ n, e })
          ;(lastLoadedTemplateRef as any).currentSig = sig
          lastSyncedSigRef.current = sig
          setHasUnsavedChanges(false)
        } catch {}
      }
    } catch {}
  }, [localProfileName, localNodes, localEdges, saveAsLibrary])

  // Actually load the template/profile (called from modal)
  const loadSelectedTemplate = useCallback(async () => {
    if (!pendingSelection) return
    const client = getBackendClient()
    try {
      const res: any = await client?.rpc('flowEditor.loadTemplate', { templateId: pendingSelection })
      if (res?.ok) {
        setLoadTemplateModalOpen(false)
        setPendingSelection(null)
        const t: any = await client?.rpc('flowEditor.getTemplates', {})
        if (t?.ok) {
          setAvailableTemplates(t.templates || [])
          setTemplatesLoaded(!!t.templatesLoaded)
          setSelectedTemplate(t.selectedTemplate || pendingSelection)
        }
        const g: any = await client?.rpc('flowEditor.getGraph', {})
        if (g?.ok) {
          const nodes = Array.isArray(g.nodes) ? g.nodes : []
          const edges = Array.isArray(g.edges) ? g.edges : []
          const styledNodes = nodes.map((n: any) => ({ ...n, data: { ...(n.data || {}), __runtime: runtimeNodeStateRef.current?.[n.id] || null } }))
          hydrateFromMain({ nodes: styledNodes, edges })
          const nSig = JSON.stringify({ n: nodes.map((x: any) => ({ id: x?.id, p: x?.position, t: x?.data?.nodeType, l: x?.data?.labelBase ?? x?.data?.label, c: x?.data?.config ?? null })), e: edges.map((x: any) => ({ id: x?.id, s: x?.source, t: x?.target, sh: (x as any)?.sourceHandle ?? undefined, th: (x as any)?.targetHandle ?? undefined })) })
          ;(lastLoadedTemplateRef as any).currentSig = nSig
          lastSyncedSigRef.current = nSig
          setHasUnsavedChanges(false)
        }
      }
    } catch {}
  }, [pendingSelection, hydrateFromMain])

  // Handle modal cancel
  const handleCancelLoad = useCallback(() => {
    setLoadTemplateModalOpen(false)
    setPendingSelection(null)
  }, [])

  // ===== HYDRATION: Load templates and graph from backend =====
  const lastLoadedTemplateRef = useRef<string | null>(null)
  // Keep a ref of last synced signature to avoid sending unchanged graphs to backend
  const lastSyncedSigRef = useRef<string | null>(null)

  // Ensure we subscribe to backend events before taking the first snapshot
  const [graphSubReady, setGraphSubReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const client = getBackendClient()

    // Only snapshot after subscription is in place to avoid missing in-flight changes
    if (!graphSubReady) return

    const computeSig = (nodes: any[], edges: any[]) => {
      try {
        const n = (nodes || []).map((x: any) => ({ id: x?.id, p: x?.position, t: x?.data?.nodeType, l: x?.data?.labelBase ?? x?.data?.label, c: x?.data?.config ?? null }))
        const e = (edges || []).map((x: any) => ({ id: x?.id, s: x?.source, t: x?.target, sh: (x as any)?.sourceHandle ?? undefined, th: (x as any)?.targetHandle ?? undefined }))
        return JSON.stringify({ n, e })
      } catch { return '' }
    }

    ;(async () => {
      try {
        await (client as any)?.whenReady?.(7000)
        const t: any = await client?.rpc('flowEditor.getTemplates', {})
        if (!cancelled && t?.ok) {
          setAvailableTemplates(t.templates || [])
          setTemplatesLoaded(!!t.templatesLoaded)
          setSelectedTemplate(t.selectedTemplate || '')
        }
        const g: any = await client?.rpc('flowEditor.getGraph', {})
        if (!cancelled && g?.ok) {
          const nodes = Array.isArray(g.nodes) ? g.nodes : []
          const edges = Array.isArray(g.edges) ? g.edges : []
          const styledNodes = nodes.map((n: any) => ({
            ...n,
            data: { ...(n.data || {}), __runtime: runtimeNodeStateRef.current?.[n.id] || null }
          }))
          hydrateFromMain({ nodes: styledNodes, edges })
          const sig = computeSig(nodes, edges)
          ;(lastLoadedTemplateRef as any).currentSig = sig
          lastLoadedTemplateRef.current = t?.selectedTemplate || ''
          lastSyncedSigRef.current = sig
          setHasUnsavedChanges(false)
        }
      } catch {}
    })()

    return () => { cancelled = true }
  }, [hydrateFromMain, graphSubReady])

  // Subscribe to backend notifications when graph/template changes in main
  useEffect(() => {
    const client = getBackendClient()
    if (!client) return

    // Subscribe first, then allow snapshot
    const unsub = (client as any).subscribe?.('flowEditor.graph.changed', async (_params: any) => {
      try {
        const t: any = await (client as any).rpc('flowEditor.getTemplates', {})
        if (t?.ok) {
          setAvailableTemplates(t.templates || [])
          setTemplatesLoaded(!!t.templatesLoaded)
          setSelectedTemplate(t.selectedTemplate || '')
        }
        const g: any = await (client as any).rpc('flowEditor.getGraph', {})
        if (g?.ok) {
          const nodes = Array.isArray(g.nodes) ? g.nodes : []
          const edges = Array.isArray(g.edges) ? g.edges : []
          const styledNodes = nodes.map((n: any) => ({
            ...n,
            data: { ...(n.data || {}), __runtime: runtimeNodeStateRef.current?.[n.id] || null }
          }))
          hydrateFromMain({ nodes: styledNodes, edges })
          try {
            const n = (nodes || []).map((x: any) => ({ id: x?.id, p: x?.position, t: x?.data?.nodeType, l: x?.data?.labelBase ?? x?.data?.label, c: x?.data?.config ?? null }))
            const e = (edges || []).map((x: any) => ({ id: x?.id, s: x?.source, t: x?.target, sh: (x as any)?.sourceHandle ?? undefined, th: (x as any)?.targetHandle ?? undefined }))
            const sig = JSON.stringify({ n, e })
            ;(lastLoadedTemplateRef as any).currentSig = sig
            lastSyncedSigRef.current = sig
            setHasUnsavedChanges(false)
          } catch {}
        }
      } catch {}
    })

    // Mark subscription ready for initial snapshot
    setGraphSubReady(true)
    return () => { try { unsub?.() } catch {} }
  }, [hydrateFromMain])


  // Debounced sync of local graph to main store only when dirty
  useEffect(() => {
    // Guard: do not sync until we've hydrated from main to avoid overwriting with empty graph
    if (!(lastLoadedTemplateRef as any).currentSig) {
      return
    }
    const t = setTimeout(() => {
      try {
        const n = (localNodes || []).map((x: any) => ({ id: x?.id, p: x?.position, t: x?.data?.nodeType, l: x?.data?.labelBase ?? x?.data?.label, c: x?.data?.config ?? null }))
        const e = (localEdges || []).map((x: any) => ({ id: x?.id, s: x?.source, t: x?.target, sh: (x as any)?.sourceHandle ?? undefined, th: (x as any)?.targetHandle ?? undefined }))
        const sig = JSON.stringify({ n, e })

        // On first run after hydration, seed from hydration signature if present
        if (lastSyncedSigRef.current === null && (lastLoadedTemplateRef as any).currentSig) {
          lastSyncedSigRef.current = (lastLoadedTemplateRef as any).currentSig
        }

        const client = getBackendClient()
        if (sig !== lastSyncedSigRef.current) {
          void client?.rpc('flowEditor.setGraph', { nodes: localNodes, edges: localEdges })
          lastSyncedSigRef.current = sig
        }
        // Update local unsaved marker vs last loaded snapshot
        const loadedSig = (lastLoadedTemplateRef as any).currentSig
        setHasUnsavedChanges(!!loadedSig && sig !== loadedSig)
      } catch {
        // Fallback: if signature fails, still sync to backend
        const client = getBackendClient()
        void client?.rpc('flowEditor.setGraph', { nodes: localNodes, edges: localEdges })
      }
    }, 500)
    return () => clearTimeout(t)
  }, [localNodes, localEdges])


  // ===== NO CONTINUOUS SYNC OF GRAPH STRUCTURE =====
  // We only sync nodes/edges to the store when explicitly needed (execute, save, etc.)
  // This eliminates unnecessary IPC overhead and prevents local changes from being overwritten
  // Execution state (flowState) is synced store → renderer for visual styling

  // Dev-only: re-render trace for FlowCanvasPanel
  const ids = (arr: any[]) => (Array.isArray(arr) ? arr.map((n: any) => n?.id).join('|') : '')
  useRerenderTrace('FlowCanvasPanel', {
    localNodesSig: `${localNodes?.length || 0}:${ids(localNodes)}`,
    localEdgesSig: `${localEdges?.length || 0}:${ids(localEdges)}`,
    status,
    paused: Boolean(pausedNode),
    selectedTemplate: selectedTemplate || '',
    hasUnsavedChanges: Boolean(hasUnsavedChanges),
  })



  // Track measured dimensions in a ref (doesn't trigger re-renders)
  const nodeDimensionsRef = useRef<Record<string, { width?: number; height?: number }>>({})

  // Handlers for node updates (passed to FlowNode components)
  const handleNodeLabelChange = useCallback((nodeId: string, newLabel: string) => {
    const updated = localNodes.map(n =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, labelBase: newLabel, label: newLabel } }
        : n
    )
    setLocalNodes(updated as any)
  }, [localNodes, setLocalNodes])

  const handleNodeConfigChange = useCallback((nodeId: string, patch: any) => {
    const updated = localNodes.map(n =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, config: { ...(n.data?.config || {}), ...patch } } }
        : n
    )
    setLocalNodes(updated as any)
  }, [localNodes, setLocalNodes])

  const handleNodeExpandToggle = useCallback((nodeId: string) => {
    const updated = localNodes.map(n =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, expanded: !n.data?.expanded } }
        : n
    )
    setLocalNodes(updated as any)
  }, [localNodes, setLocalNodes])

  // ===== MERGE: Execution state with local nodes for display =====
  const displayNodes = useMemo(() => {
    const fs = runtimeNodeStateRef.current as any
    return localNodes.map(node => {
      const execState = fs?.[node.id]
      const dims = nodeDimensionsRef.current[node.id]

      // CRITICAL: Always attach handlers to all nodes so editing works
      // CRITICAL: Preserve width/height from ref (ReactFlow sets these after measuring)
      return {
        ...node,
        width: dims?.width || node.width,
        height: dims?.height || node.height,
        style: execState?.style || node.style,
        data: {
          ...node.data,
          status: execState?.status,
          cacheHit: execState?.cacheHit,
          durationMs: execState?.durationMs,
          costUSD: execState?.costUSD,
          detectedIntent: execState?.detectedIntent,
          // Pass handlers to node components via data
          onLabelChange: handleNodeLabelChange,
          onConfigChange: handleNodeConfigChange,
          onExpandToggle: handleNodeExpandToggle,
        },
      }
    })
  }, [localNodes, nodeStateSig, handleNodeLabelChange, handleNodeConfigChange, handleNodeExpandToggle])

  // Auto-layout handler - operates on local state
  const handleAutoLayout = useCallback(() => {
    const layoutedNodes = getLayoutedElements(localNodes, localEdges, 'LR')
    setLocalNodes(layoutedNodes)

    // Fit view after layout
    setTimeout(() => {
      rfRef.current?.fitView({ padding: 0.2, duration: 300 })
    }, 50)
  }, [localNodes, localEdges])


  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Handle dimension changes by storing them in ref
    const dimensionChanges = changes.filter(ch => ch.type === 'dimensions') as any[]
    for (const change of dimensionChanges) {
      if (change.id && change.dimensions) {
        nodeDimensionsRef.current[change.id] = {
          width: change.dimensions.width,
          height: change.dimensions.height,
        }
      }
    }

    // Filter out dimension changes for further processing
    const relevantChanges = changes.filter(change =>
      change.type !== 'dimensions'
    )

    if (relevantChanges.length === 0) return

    // Apply ALL changes to local state immediately for smooth interaction
    // Filter out deletion of defaultContextStart node
    const filteredChanges = relevantChanges.filter(change => {
      if (change.type === 'remove') {
        const node = localNodes.find(n => n.id === (change as any).id)
        if (node && (node.data as any)?.nodeType === 'defaultContextStart') {
          return false // Don't allow deletion of defaultContextStart
        }
      }
      return true
    })

    const updated = applyNodeChanges(filteredChanges, localNodes as FlowNode[]) as FlowNode[]
    // Also update dimensions ref from the updated nodes
    for (const node of updated) {
      if (node.width !== undefined && node.width !== null && node.height !== undefined && node.height !== null) {
        nodeDimensionsRef.current[node.id] = {
          width: node.width,
          height: node.height,
        }
      }
    }
    setLocalNodes(updated as any)

    // Local state changes will trigger debounced sync to store automatically
  }, [localNodes])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    // Apply changes to local state immediately
    const updated = applyEdgeChanges(changes, localEdges as Edge[]) as Edge[]
    setLocalEdges(updated as any)

    // Local state changes will trigger debounced sync to store automatically
  }, [localEdges])

  const onConnect = useCallback((connection: Connection) => {
    const sourceHandle = connection.sourceHandle
    const targetHandle = connection.targetHandle

    // Prevent exact-duplicate edge
    const id = `${connection.source}-${connection.target}-${sourceHandle || 'data'}-${targetHandle || 'data'}`
    const exists = (localEdges as Edge[]).some((e: any) => {
      const sh = (e as any).sourceHandle || 'data'
      const th = (e as any).targetHandle || 'data'
      return e.source === connection.source && e.target === connection.target && sh === (sourceHandle || 'data') && th === (targetHandle || 'data')
    })
    if (exists) {
      try {
        notifications.show({ color: 'yellow', title: 'Edge already exists', message: 'This connection is already in the graph.' })
      } catch {}
      return
    }

    // Find source node to determine context type
    const sourceNode = localNodes.find(n => n.id === connection.source)
    const sourceNodeType = (sourceNode as any)?.data?.nodeType

    // Determine edge color based on handles and source node type
    const color = getConnectionColorFromHandles(
      sourceHandle || undefined,
      targetHandle || undefined,
      sourceNodeType
    )

    const newEdge = {
      id,
      source: connection.source!,
      target: connection.target!,
      sourceHandle: sourceHandle || undefined,
      targetHandle: targetHandle || undefined,
      type: 'smoothstep',
      style: { stroke: color, strokeWidth: 2 },
      markerEnd: { type: 'arrowclosed' as any, color },
    }

    // Add to local state immediately
    setLocalEdges([...(localEdges as Edge[]), newEdge] as any)

    // Local state changes will trigger debounced sync to store automatically
  }, [localNodes, localEdges])

  // Enhance edges with selection styling and handle-based colors
  const styledEdges = useMemo(() => {
    // Safety check: ensure edges is an array
    if (!Array.isArray(localEdges)) {
      return []
    }
    return localEdges.map(edge => {
      const sourceHandle = (edge as any).sourceHandle
      const targetHandle = (edge as any).targetHandle

      // Find source node to determine context type
      const sourceNode = localNodes.find(n => n.id === (edge as any).source)
      const sourceNodeType = (sourceNode as any)?.data?.nodeType

      // Determine edge color based on handles and source node type
      const color = getConnectionColorFromHandles(sourceHandle, targetHandle, sourceNodeType)

      return {
        ...edge,
        type: 'smoothstep',
        animated: false,
        style: edge.selected
          ? { stroke: CONNECTION_COLORS.selected, strokeWidth: 3 }
          : { stroke: color, strokeWidth: 2 },
        markerEnd: {
          type: 'arrowclosed' as any,
          color: edge.selected ? CONNECTION_COLORS.selected : color
        },
      }
    })
  }, [localEdges, localNodes])

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      borderLeft: '1px solid #3e3e42',
      background: '#1e1e1e',
      position: 'relative'
    }}>
      {/* Toolbar */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid #3e3e42',
        background: '#252526',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12
      }}>
        <Group gap="xs">

          <Text size="sm" c="#ccc">Editing</Text>

          {/* Hybrid Flow Selector with CRUD operations */}
          <Menu shadow="md" width={280} position="bottom-start">
            <Menu.Target>
              <Button
                size="xs"
                variant="default"
                rightSection={<IconChevronDown size={14} />}
                style={{ minWidth: 200 }}
                styles={{
                  root: { fontSize: 12 },
                  section: { marginLeft: 4 }
                }}
              >
                {selectedTemplate || 'Select flow...'}
              </Button>
            </Menu.Target>

            <Menu.Dropdown>
              {/* Flow selection section */}
              <Menu.Label>Select Flow</Menu.Label>
              <TextInput
                placeholder="Type to filter flows"
                value={templateFilter}
                onChange={(e) => setTemplateFilter(e.currentTarget.value)}
                size="xs"
                styles={{ input: { background: '#1e1e1e', color: '#ddd' } }}
              />
              <Menu.Divider />

              {allTemplates.length === 0 ? (
                <Menu.Item disabled style={{ fontSize: 12 }}>
                  {templatesLoaded ? 'No flows available' : 'Loading...'}
                </Menu.Item>
              ) : ((templateFilter || '').trim().length > 0 ? (
                // Typeahead across all templates
                (() => {
                  const q = (templateFilter || '').trim().toLowerCase()
                  const matches = allTemplates.filter((t: any) =>
                    String(t.name || t.id || '').toLowerCase().includes(q) ||
                    String(t.id || '').toLowerCase().includes(q)
                  )
                  return matches.length > 0
                    ? matches.map((t: any) => {
                      const lib =
                        t.library === 'system'
                          ? 'System'
                          : t.library === 'workspace'
                            ? 'Workspace'
                            : 'User'
                      return (
                        <Menu.Item
                          key={t.id}
                          onClick={() => handleSelectionChange(t.id)}
                          style={{
                            fontSize: 12,
                            backgroundColor: selectedTemplate === t.id ? 'rgba(66, 153, 225, 0.1)' : undefined,
                          }}
                        >
                          <Group gap={6}>
                            <Text size="xs" c="#999" style={{ width: 86 }}>{`[${getLibraryLabel(t.library)}]`}</Text>
                            <Text size="sm">{t.name}</Text>
                          </Group>
                        </Menu.Item>
                      )
                    })
                    : (
                      <Menu.Item disabled style={{ fontSize: 12 }}>
                        No flows
                      </Menu.Item>
                    )
                })()
              ) : (
                // Library groups: System, User, Workspace
                <>
                  {systemTemplates.length > 0 && (
                    <Menu withinPortal offset={6} position="right-start" trigger="hover" openDelay={80} closeDelay={120}>
                      <Menu.Target>
                        <Menu.Item rightSection={<IconChevronRight size={12} />}>System Library</Menu.Item>
                      </Menu.Target>
                      <Menu.Dropdown style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                        {systemTemplates.map((t: any) => (
                          <Menu.Item
                            key={t.id}
                            onClick={() => handleSelectionChange(t.id)}
                            style={{
                              fontSize: 12,
                              backgroundColor: selectedTemplate === t.id ? 'rgba(66, 153, 225, 0.1)' : undefined,
                            }}
                          >
                            {t.name}
                            {selectedTemplate === t.id && ' ✓'}
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                  )}

                  {userTemplates.length > 0 && (
                    <Menu withinPortal offset={6} position="right-start" trigger="hover" openDelay={80} closeDelay={120}>
                      <Menu.Target>
                        <Menu.Item rightSection={<IconChevronRight size={12} />}>User Library</Menu.Item>
                      </Menu.Target>
                      <Menu.Dropdown style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                        {userTemplates.map((t: any) => (
                          <Menu.Item
                            key={t.id}
                            onClick={() => handleSelectionChange(t.id)}
                            style={{
                              fontSize: 12,
                              backgroundColor: selectedTemplate === t.id ? 'rgba(66, 153, 225, 0.1)' : undefined,
                            }}
                          >
                            {t.name}
                            {selectedTemplate === t.id && ' ✓'}
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                  )}

                  {workspaceTemplates.length > 0 && (
                    <Menu withinPortal offset={6} position="right-start" trigger="hover" openDelay={80} closeDelay={120}>
                      <Menu.Target>
                        <Menu.Item rightSection={<IconChevronRight size={12} />}>Workspace Library</Menu.Item>
                      </Menu.Target>
                      <Menu.Dropdown style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                        {workspaceTemplates.map((t: any) => (
                          <Menu.Item
                            key={t.id}
                            onClick={() => handleSelectionChange(t.id)}
                            style={{
                              fontSize: 12,
                              backgroundColor: selectedTemplate === t.id ? 'rgba(66, 153, 225, 0.1)' : undefined,
                            }}
                          >
                            {t.name}
                            {selectedTemplate === t.id && ' ✓'}
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                  )}

                  {(systemTemplates.length + userTemplates.length + workspaceTemplates.length === 0) && (
                    <Menu.Item disabled style={{ fontSize: 12 }}>
                      No flows
                    </Menu.Item>
                  )}
                </>
              ))}

            </Menu.Dropdown>
          </Menu>

          {/* Actions: New, Save As, Delete */}
          <Button
            size="xs"
            variant="default"
            leftSection={<IconPlus size={14} />}
            onClick={() => {
              if (hasUnsavedChanges) {
                const ok = confirm('You have unsaved changes. Create a new flow?')
                if (!ok) return
              }
              setNewFlowName('')
              setNewFlowError(null)
              setNewFlowModalOpen(true)
            }}
          >
            New
          </Button>

          <Button
            size="xs"
            variant="default"
            leftSection={<IconCopy size={14} />}
            onClick={() => {
              try {
                const tpl = (availableTemplates || []).find((t: any) => t.id === selectedTemplate)
                const lib = tpl?.library === 'workspace' ? 'workspace' : 'user'
                setSaveAsLibrary(lib)
              } catch {
                setSaveAsLibrary('workspace')
              }
              setSaveAsModalOpen(true)
            }}
          >
            Save As
          </Button>

          <Button
            size="xs"
            variant="default"
            color="red"
            leftSection={<IconTrash size={14} />}
            disabled={!selectedTemplate || isSystemTemplate(selectedTemplate)}
            onClick={async () => {
              if (!selectedTemplate || isSystemTemplate(selectedTemplate)) return
              if (confirm(`Delete profile "${selectedTemplate}"?`)) {
                const client = getBackendClient()
                try {
                  const res: any = await client?.rpc('flowEditor.deleteProfile', { name: selectedTemplate })
                  if (res?.ok) {
                    // Refresh templates/meta and current graph
                    const t: any = await client?.rpc('flowEditor.getTemplates', {})
                    if (t?.ok) {
                      setAvailableTemplates(t.templates || [])
                      setTemplatesLoaded(!!t.templatesLoaded)
                      setSelectedTemplate(t.selectedTemplate || '')
                    }
                    const g: any = await client?.rpc('flowEditor.getGraph', {})
                    if (g?.ok) {
                      const nodes = Array.isArray(g.nodes) ? g.nodes : []
                      const edges = Array.isArray(g.edges) ? g.edges : []
                      hydrateFromMain({ nodes, edges })
                      try {
                        const n = (nodes || []).map((x: any) => ({ id: x?.id, p: x?.position, t: x?.data?.nodeType, l: x?.data?.labelBase ?? x?.data?.label, c: x?.data?.config ?? null }))
                        const e = (edges || []).map((x: any) => ({ id: x?.id, s: x?.source, t: x?.target, sh: (x as any)?.sourceHandle ?? undefined, th: (x as any)?.targetHandle ?? undefined }))
                        const sig = JSON.stringify({ n, e })
                        ;(lastLoadedTemplateRef as any).currentSig = sig
                        lastSyncedSigRef.current = sig
                        setHasUnsavedChanges(false)
                      } catch {}
                    }
                  }
                } catch {}
              }
            }}
          >
            Delete
          </Button>


          {/* Auto-save indicator for user flows */}
          {selectedTemplate && !isSystemTemplate(selectedTemplate) && hasUnsavedChanges && (
            <Badge
              size="xs"
              variant="dot"
              color="blue"
              title="Auto-saving..."
            >
              Saving...
            </Badge>
          )}
        </Group>

      </div>

      {/* Save As Modal */}
      {/* New Flow Modal */}
      <Modal
        opened={newFlowModalOpen}
        onClose={() => {
          resetNewFlowModal()
        }}
        title="Create New Flow"
        size="sm"
      >
        <TextInput
          label="Flow Name"
          placeholder="Enter flow name"
          value={newFlowName}
          onChange={(e) => {
            setNewFlowName(e.currentTarget.value)
            if (newFlowError) setNewFlowError(null)
          }}
          onKeyDown={async (e) => {
            if (e.key === 'Enter') {
              const name = newFlowName.trim()
              if (!name) return
              const exists = (availableTemplates || []).some((t: any) => {
                const n = (t.name || '').toLowerCase()
                const id = (t.id || '').toLowerCase()
                const target = name.toLowerCase()
                return n === target || id === target
              })
              if (exists) {
                setNewFlowError(`A flow named "${name}" already exists. Please choose another name.`)
                return
              }
              const client = getBackendClient()
              try {
                const res: any = await client?.rpc('flowEditor.createNewFlowNamed', { name })
                if (res?.ok) {
                  // Refresh templates/meta and current graph
                  const t: any = await client?.rpc('flowEditor.getTemplates', {})
                  if (t?.ok) {
                    setAvailableTemplates(t.templates || [])
                    setTemplatesLoaded(!!t.templatesLoaded)
                    setSelectedTemplate(t.selectedTemplate || name)
                  }
                  const g: any = await client?.rpc('flowEditor.getGraph', {})
                  if (g?.ok) {
                    const nodes = Array.isArray(g.nodes) ? g.nodes : []
                    const edges = Array.isArray(g.edges) ? g.edges : []
                    hydrateFromMain({ nodes, edges })
                    try {
                      const n = (nodes || []).map((x: any) => ({ id: x?.id, p: x?.position, t: x?.data?.nodeType, l: x?.data?.labelBase ?? x?.data?.label, c: x?.data?.config ?? null }))
                      const e = (edges || []).map((x: any) => ({ id: x?.id, s: x?.source, t: x?.target, sh: (x as any)?.sourceHandle ?? undefined, th: (x as any)?.targetHandle ?? undefined }))
                      const sig = JSON.stringify({ n, e })
                      ;(lastLoadedTemplateRef as any).currentSig = sig
                      lastSyncedSigRef.current = sig
                      setHasUnsavedChanges(false)
                    } catch {}
                  }
                }
              } catch {}
              resetNewFlowModal()
            }
          }}
          autoFocus
        />
        {newFlowError && (
          <Text size="xs" c="red" mt="xs">{newFlowError}</Text>
        )}
        <Group mt="md" justify="flex-end">
          <Button
            variant="subtle"
            onClick={() => {
              resetNewFlowModal()
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={async () => {
              const name = newFlowName.trim()
              if (!name) return
              const exists = (availableTemplates || []).some((t: any) => {
                const n = (t.name || '').toLowerCase()
                const id = (t.id || '').toLowerCase()
                const target = name.toLowerCase()
                return n === target || id === target
              })
              if (exists) {
                setNewFlowError(`A flow named "${name}" already exists. Please choose another name.`)
                return
              }
              const client = getBackendClient()
              try {
                const res: any = await client?.rpc('flowEditor.createNewFlowNamed', { name })
                if (res?.ok) {
                  const t: any = await client?.rpc('flowEditor.getTemplates', {})
                  if (t?.ok) {
                    setAvailableTemplates(t.templates || [])
                    setTemplatesLoaded(!!t.templatesLoaded)
                    setSelectedTemplate(t.selectedTemplate || name)
                  }
                  const g: any = await client?.rpc('flowEditor.getGraph', {})
                  if (g?.ok) {
                    const nodes = Array.isArray(g.nodes) ? g.nodes : []
                    const edges = Array.isArray(g.edges) ? g.edges : []
                    hydrateFromMain({ nodes, edges })
                    try {
                      const n = (nodes || []).map((x: any) => ({ id: x?.id, p: x?.position, t: x?.data?.nodeType, l: x?.data?.labelBase ?? x?.data?.label, c: x?.data?.config ?? null }))
                      const e = (edges || []).map((x: any) => ({ id: x?.id, s: x?.source, t: x?.target, sh: (x as any)?.sourceHandle ?? undefined, th: (x as any)?.targetHandle ?? undefined }))
                      const sig = JSON.stringify({ n, e })
                      ;(lastLoadedTemplateRef as any).currentSig = sig
                      lastSyncedSigRef.current = sig
                      setHasUnsavedChanges(false)
                    } catch {}
                  }
                }
              } catch {}
              resetNewFlowModal()
            }}
            disabled={!newFlowName.trim()}
          >
            Create
          </Button>
        </Group>
      </Modal>

      <Modal
        opened={saveAsModalOpen}
        onClose={() => {
          setSaveAsModalOpen(false)
          setLocalProfileName('')
        }}
        title="Save Flow Profile As"
        size="sm"
      >
        <TextInput
          label="Profile Name"
          placeholder="Enter profile name"
          value={localProfileName}
          onChange={(e) => setLocalProfileName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleSaveAs()
            }
          }}
          autoFocus
        />
        <Text size="xs" mt="sm">
          Save to
        </Text>
        <Group mt="xs" gap="xs">
          <Button
            size="xs"
            variant={saveAsLibrary === 'workspace' ? 'filled' : 'default'}
            onClick={() => setSaveAsLibrary('workspace')}
          >
            Workspace (.hifide-public/flows)
          </Button>
          <Button
            size="xs"
            variant={saveAsLibrary === 'user' ? 'filled' : 'default'}
            onClick={() => setSaveAsLibrary('user')}
          >
            User (global)
          </Button>
        </Group>

        <Group mt="md" justify="flex-end">
          <Button
            variant="subtle"
            onClick={() => {
              setSaveAsModalOpen(false)
              setLocalProfileName('')
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSaveAs}
            disabled={!localProfileName.trim()}
          >
            Save
          </Button>
        </Group>
      </Modal>

      {/* Load Template Confirmation Modal */}
      <Modal
        opened={loadTemplateModalOpen}
        onClose={handleCancelLoad}
        title="Unsaved Changes"
        size="sm"
      >
        <Text size="sm" mb="md">
          You have unsaved changes. Loading a new flow will discard them.
        </Text>
        <Group mt="md" justify="flex-end">
          <Button
            variant="subtle"
            onClick={handleCancelLoad}
          >
            Cancel
          </Button>
          <Button
            color="blue"
            onClick={loadSelectedTemplate}
          >
            Load Anyway
          </Button>
        </Group>
      </Modal>

      {/* ReactFlow Canvas */}
      <div style={{ flex: 1, background: '#1e1e1e', position: 'relative' }}>
        <ReactFlow
          ref={rfRef}
          nodes={displayNodes as FlowNode[]}
          edges={styledEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={(event) => {
            event.preventDefault()
            const nodeType = event.dataTransfer.getData('application/reactflow')
            if (!nodeType) return

            // Prevent adding multiple defaultContextStart nodes
            if (nodeType === 'defaultContextStart') {
              const hasDefaultContextStart = localNodes.some(n => (n.data as any)?.nodeType === 'defaultContextStart')
              if (hasDefaultContextStart) {
                return
              }
            }

            // Calculate position in flow coordinates using screenToFlowPosition
            const position = reactFlowInstance.screenToFlowPosition({
              x: event.clientX,
              y: event.clientY,
            })

            const match = NODE_PALETTE.find((p) => p.nodeType === nodeType)
            const label = match?.label || nodeType

            // Create new node
            const id = `${nodeType}-${Date.now()}`

            // Set default config for certain node types
            let defaultConfig: Record<string, any> = {}
            if (nodeType === 'newContext') {
              defaultConfig = { provider: 'openai', model: 'gpt-4o' }
            } else if (nodeType === 'llmRequest') {
              defaultConfig = { provider: 'openai', model: 'gpt-4o' }
            }

            const newNode: FlowNode = {
              id,
              type: 'hifiNode',
              data: { nodeType, label, labelBase: label, config: defaultConfig, expanded: nodeType === 'readFile' },
              position,
            }

            // Add to local state (will be synced to store when user executes/saves)
            setLocalNodes([...(localNodes as FlowNode[]), newNode] as any)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
          }}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={{
            type: 'smoothstep',
            animated: false,
            style: { stroke: CONNECTION_COLORS.default, strokeWidth: 2 },
            markerEnd: { type: 'arrowclosed' as any, color: CONNECTION_COLORS.default }
          }}
          fitView
          proOptions={{ hideAttribution: true }}
          style={{ background: '#1e1e1e' }}
          deleteKeyCode={['Backspace', 'Delete']}
          selectionKeyCode={null}
        >
          <Background color="#333" gap={16} />
          <Controls>
            <ControlButton onClick={handleAutoLayout} title="Auto-layout nodes">
              <IconLayoutDistributeVertical size={16} color="#222" />
            </ControlButton>
          </Controls>
          <MiniMap
            style={{ background: '#252526', border: '1px solid #3e3e42' }}
            nodeColor={(node) => {
              const nodeType = (node.data as any)?.nodeType
              return getNodeColor(nodeType)
            }}
          />
        </ReactFlow>
      </div>
    </div>
  )
}

