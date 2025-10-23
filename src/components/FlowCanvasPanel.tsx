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
import { useAppStore, useDispatch } from '../store'
import { useFlowEditorLocal } from '../store/flowEditorLocal'
import { useRerenderTrace, logStoreDiff } from '../utils/perf'

import { Button, Group, Badge, TextInput, Modal, Text, Menu, UnstyledButton } from '@mantine/core'
import { IconLayoutDistributeVertical, IconChevronDown, IconPlus, IconCopy, IconTrash, IconChevronRight } from '@tabler/icons-react'
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

  // Use dispatch for actions
  const dispatch = useDispatch()
  const setFlowCanvasCollapsed = useUiStore((s) => s.setFlowCanvasCollapsed)

  // ===== LOCAL STATE (Instant UI Updates - Renderer-only store) =====
  // Nodes and edges are kept in a renderer-local zustand store for responsiveness
  // They are debounced-synced to the main store
  const localNodes = useFlowEditorLocal((s) => s.nodes) as FlowNode[]
  const setLocalNodes = useFlowEditorLocal((s) => s.setNodes)
  const localEdges = useFlowEditorLocal((s) => s.edges) as Edge[]
  const setLocalEdges = useFlowEditorLocal((s) => s.setEdges)
  const hydrateFromMain = useFlowEditorLocal((s) => s.hydrateFromMain)

  // ===== REMOTE STATE (Execution & Persistence) =====
  // These come from the main store and are read-only in the renderer
  const storeNodes = useAppStore((s) => s.feNodes)
  const storeEdges = useAppStore((s) => s.feEdges)
  // Execution state (metadata only) - subscribe manually to avoid ref-only rerenders from IPC
  const flowStateRef = useRef<Record<string, any>>({})
  const [flowStateSig, setFlowStateSig] = useState<string>('')
  useEffect(() => {
    let prevSig = ''
    const mkSig = (fs: any) => {
      try {
        return JSON.stringify(
          Object.entries(fs || {})
            .sort(([a],[b]) => a.localeCompare(b))
            .map(([id, v]: any) => ({ id, st: v?.status, ch: v?.cacheHit, dm: v?.durationMs, c: v?.costUSD, sb: v?.style?.border, ss: v?.style?.boxShadow }))
        )
      } catch {
        return ''
      }
    }
    // Seed from current state
    const s = (useAppStore as any).getState()
    flowStateRef.current = s?.feFlowState || {}
    prevSig = mkSig(flowStateRef.current)
    setFlowStateSig(prevSig)
    // Subscribe to changes
    const unsub = (useAppStore as any).subscribe((next: any) => {
      const fs = next?.feFlowState || {}
      const sig = mkSig(fs)
      if (sig !== prevSig) {
        flowStateRef.current = fs
        prevSig = sig
        setFlowStateSig(sig)
      }
    })
    return () => unsub?.()
  }, [])
  const status = useAppStore((s) => s.feStatus)
  const pausedNode = useAppStore((s) => s.fePausedNode)
  const currentProfile = useAppStore((s) => s.feCurrentProfile)
  const availableTemplates = useAppStore((s) => s.feAvailableTemplates)
  const templatesLoaded = useAppStore((s) => s.feTemplatesLoaded)
  const selectedTemplate = useAppStore((s) => s.feSelectedTemplate)
  const hasUnsavedChanges = useAppStore((s) => s.feHasUnsavedChanges)

  // Helper to check if a template is from system library
  const isSystemTemplate = useCallback((templateId: string) => {
    const template = availableTemplates.find((t: any) => t.id === templateId)
    return template?.library === 'system'
  }, [availableTemplates])
  const saveAsModalOpen = useAppStore((s) => s.feSaveAsModalOpen)
  const loadTemplateModalOpen = useAppStore((s) => s.feLoadTemplateModalOpen)

  // Use local state for profile name input to avoid lag on every keystroke
  const [localProfileName, setLocalProfileName] = useState('')

  // New Flow modal state (renderer-only UI store)
  const newFlowModalOpen = useUiStore((s) => s.newFlowModalOpen)
  const newFlowName = useUiStore((s) => s.newFlowName)
  const newFlowError = useUiStore((s) => s.newFlowError)
  const setNewFlowModalOpen = useUiStore((s) => s.setNewFlowModalOpen)
  const setNewFlowName = useUiStore((s) => s.setNewFlowName)
  const setNewFlowError = useUiStore((s) => s.setNewFlowError)
  const resetNewFlowModal = useUiStore((s) => s.resetNewFlowModal)

  // Memoize template options for Select component
  const templateOptions = useMemo(() => {
    if (!availableTemplates || availableTemplates.length === 0) {
      return []
    }

    try {
      // Separate system and user templates
      const systemTemplates: Array<{ value: string; label: string }> = []
      const userTemplates: Array<{ value: string; label: string }> = []

      availableTemplates.forEach((template: any) => {
        if (!template || !template.id || !template.name) {
          return
        }

        const icon = template.library === 'system' ? '📦' : '💾'
        const item = {
          value: template.id,
          label: `${icon} ${template.name}`,
        }

        if (template.library === 'system') {
          systemTemplates.push(item)
        } else {
          userTemplates.push(item)
        }
      })

      // Build grouped data structure for Mantine Select
      const result: Array<{ group: string; items: Array<{ value: string; label: string }> }> = []

      if (systemTemplates.length > 0) {
        result.push({
          group: 'System Library',
          items: systemTemplates
        })
      }

      if (userTemplates.length > 0) {
        result.push({
          group: 'User Library',
          items: userTemplates
        })
      }

      return result
    } catch (error) {
      console.error('Error loading options:', error)
      return []
    }
  }, [availableTemplates])

  // No useEffect needed - templates are loaded by initFlowEditor in the store

  // Handle profile/template selection - auto-load when selected
  const handleSelectionChange = useCallback((value: string | null) => {
    if (!value) return

    // Check for unsaved changes before loading
    if (hasUnsavedChanges) {
      // Store the pending selection and show confirmation modal
      dispatch('feSetSelectedTemplate', { id: value })
      dispatch('feSetLoadTemplateModalOpen', { open: true })
      return
    }

    // Load directly if no unsaved changes
    dispatch('feSetSelectedTemplate', { id: value })
    dispatch('feLoadTemplate', { templateId: value })
  }, [hasUnsavedChanges, dispatch])

  // Handle save as (create new profile)
  const handleSaveAs = useCallback(async () => {
    if (!localProfileName.trim()) return

    // Sync local state to store before saving
    dispatch('feSetNodes', { nodes: localNodes })
    dispatch('feSetEdges', { edges: localEdges })

    // Then save
    await dispatch('feSaveAsProfile', { name: localProfileName })

    // Clear local input after save
    setLocalProfileName('')
  }, [localProfileName, localNodes, localEdges, dispatch])

  // Actually load the template/profile (called from modal)
  const loadSelectedTemplate = useCallback(async () => {
    if (!selectedTemplate) return
    await dispatch('feLoadTemplate', { templateId: selectedTemplate })
    dispatch('feSetLoadTemplateModalOpen', { open: false })
  }, [selectedTemplate, dispatch])

  // Handle modal cancel - revert selection to currently loaded flow
  const handleCancelLoad = useCallback(() => {
    // Revert selection to the currently loaded flow
    const currentlyLoaded = currentProfile || 'default'
    dispatch('feSetSelectedTemplate', { id: currentlyLoaded })
    dispatch('feSetLoadTemplateModalOpen', { open: false })
  }, [currentProfile, dispatch])

  // ===== INITIALIZATION: Load nodes/edges from store when template changes =====
  // Track the last loaded template to detect when a new template is loaded
  const lastLoadedTemplateRef = useRef<string | null>(null)

  useEffect(() => {
    if (!Array.isArray(storeNodes) || !Array.isArray(storeEdges)) return

    // If confirmation modal is open, do not hydrate yet (user hasn't confirmed switch)
    if (loadTemplateModalOpen) return

    // Compute current minimal signature of main store graph
    let sig = ''
    try {
      const n = (storeNodes || []).map((x: any) => ({ id: x?.id, p: x?.position, t: x?.data?.nodeType, l: x?.data?.labelBase ?? x?.data?.label, c: x?.data?.config ?? null }))
      const e = (storeEdges || []).map((x: any) => ({ id: x?.id, s: x?.source, t: x?.target, sh: (x as any)?.sourceHandle ?? undefined, th: (x as any)?.targetHandle ?? undefined }))
      sig = JSON.stringify({ n, e })
    } catch {}

    const lastSig = (lastLoadedTemplateRef as any).currentSig
    const isFirstLoad = lastLoadedTemplateRef.current === null
    const needsHydrate = isFirstLoad || !lastSig || lastSig !== sig

    if (needsHydrate) {
      hydrateFromMain({ nodes: storeNodes, edges: storeEdges })
      ;(lastLoadedTemplateRef as any).currentSig = sig
      lastLoadedTemplateRef.current = selectedTemplate
    }
  }, [storeNodes, storeEdges, selectedTemplate, loadTemplateModalOpen, hydrateFromMain])

  // Keep a ref of last synced signature to avoid dispatching unchanged graphs
  const lastSyncedSigRef = useRef<string | null>(null)

  // Debounced sync of local graph to main store only when dirty
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const n = (localNodes || []).map((x: any) => ({ id: x?.id, p: x?.position, t: x?.data?.nodeType, l: x?.data?.labelBase ?? x?.data?.label, c: x?.data?.config ?? null }))
        const e = (localEdges || []).map((x: any) => ({ id: x?.id, s: x?.source, t: x?.target, sh: (x as any)?.sourceHandle ?? undefined, th: (x as any)?.targetHandle ?? undefined }))
        const sig = JSON.stringify({ n, e })

        // On first run after hydration, seed from hydration signature if present
        if (lastSyncedSigRef.current === null && (lastLoadedTemplateRef as any).currentSig) {
          lastSyncedSigRef.current = (lastLoadedTemplateRef as any).currentSig
        }

        if (sig !== lastSyncedSigRef.current) {
          dispatch('feSetNodes', { nodes: localNodes })
          dispatch('feSetEdges', { edges: localEdges })
          lastSyncedSigRef.current = sig
        }
      } catch {
        // Fallback: if signature fails, perform the dispatch
        dispatch('feSetNodes', { nodes: localNodes })
        dispatch('feSetEdges', { edges: localEdges })
      }
    }, 500)
    return () => clearTimeout(t)
  }, [localNodes, localEdges, dispatch])


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

  // Dev-only: log fe* store key changes impacting Flow Editor
  useEffect(() => {
    if (import.meta?.env?.MODE === 'production') return
    const FE_KEYS = [
      'feNodes','feEdges','feFlowState','feStatus','fePausedNode','feMainFlowContext'
    ]
    const pickFe = (s: any) => {
      const out: any = {}
      for (const k of FE_KEYS) out[k] = (s as any)[k]
      // Replace feFlowState with a stable signature so ref-only IPC changes don't spam logs
      if (out.feFlowState && typeof out.feFlowState === 'object') {
        try {
          const sig = Object.entries(out.feFlowState as any)
            .sort(([a],[b]) => a.localeCompare(b))
            .map(([id, v]: any) => ({ id, st: v?.status, ch: v?.cacheHit, dm: v?.durationMs, c: v?.costUSD, sb: v?.style?.border, ss: v?.style?.boxShadow }))
          out.feFlowState = JSON.stringify(sig)
        } catch {}
      }
      // Replace feMainFlowContext with a stable signature as well
      if (out.feMainFlowContext && typeof out.feMainFlowContext === 'object') {
        try {
          const c: any = out.feMainFlowContext
          out.feMainFlowContext = JSON.stringify({
            p: c?.provider,
            m: c?.model,
            si: (c?.systemInstructions || '').length,
            mh: Array.isArray(c?.messageHistory) ? c.messageHistory.length : 0
          })
        } catch {}
      }
      return out
    }
    let prev = pickFe((useAppStore as any).getState())
    const unsub = (useAppStore as any).subscribe((s: any) => {
      const next = pickFe(s)
      logStoreDiff('FlowEditor fe* subset', prev, next)
      prev = next
    })
    return () => unsub?.()
  }, [])

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
    const fs = flowStateRef.current as any
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
  }, [localNodes, flowStateSig, handleNodeLabelChange, handleNodeConfigChange, handleNodeExpandToggle])

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

          <Text size="sm" c="#ccc">Current Flow:</Text>

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
              {templateOptions && templateOptions.length > 0 ? (
                templateOptions.map((group: any) => (
                  <div key={group.group}>
                    <Menu.Label style={{ fontSize: 10, color: '#888', paddingLeft: 12 }}>
                      {group.group}
                    </Menu.Label>
                    {group.items.map((item: any) => (
                      <Menu.Item
                        key={item.value}
                        onClick={() => handleSelectionChange(item.value)}
                        style={{
                          fontSize: 12,
                          backgroundColor: selectedTemplate === item.value ? 'rgba(66, 153, 225, 0.1)' : undefined
                        }}
                      >
                        {item.label}
                        {selectedTemplate === item.value && ' ✓'}
                      </Menu.Item>
                    ))}
                  </div>
                ))
              ) : (
                <Menu.Item disabled style={{ fontSize: 12 }}>
                  {templatesLoaded ? 'No flows available' : 'Loading...'}
                </Menu.Item>
              )}

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
            onClick={() => dispatch('feSetSaveAsModalOpen', { open: true })}
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
                await dispatch('feDeleteProfile', { name: selectedTemplate })
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

        <Group gap="xs">
          {/* Collapse button */}
          <UnstyledButton
            onClick={() => {
              setFlowCanvasCollapsed(true)
              dispatch('updateWindowState', { flowCanvasCollapsed: true })
            }}
            style={{
              color: '#cccccc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#ffffff'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#cccccc'
            }}
          >
            <IconChevronRight size={16} />
          </UnstyledButton>
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
              await dispatch('feCreateNewFlowNamed', { name })
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
              await dispatch('feCreateNewFlowNamed', { name })
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
          dispatch('feSetSaveAsModalOpen', { open: false })
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
        <Group mt="md" justify="flex-end">
          <Button
            variant="subtle"
            onClick={() => {
              dispatch('feSetSaveAsModalOpen', { open: false })
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
              data: { nodeType, label, labelBase: label, config: defaultConfig },
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

