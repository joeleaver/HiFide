import { useRef, useMemo, useCallback, useState, useEffect } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type Node as FlowNode,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useAppStore, useDispatch } from '../store'
import { Button, Group, Badge, TextInput, Modal, Text, Menu, Divider } from '@mantine/core'
import { IconPlayerStop, IconLayoutDistributeVertical, IconChevronDown, IconPlus, IconCopy, IconTrash, IconRefresh } from '@tabler/icons-react'
import FlowNodeComponent from './FlowNode'
import { getLayoutedElements } from '../utils/autoLayout'
import { getNodeColor } from '../../electron/store/utils/node-colors'
import { getConnectionColorFromHandles, CONNECTION_COLORS } from '../../electron/store/utils/connection-colors'

const nodeTypes = { hifiNode: FlowNodeComponent }

// Node palette definitions (excludes defaultContextStart - always present, can't be added/removed)
const NODE_PALETTE: Array<{ kind: string; label: string; icon: string; description: string }> = [
  { kind: 'userInput', label: 'User Input', icon: '👤', description: 'Accept user input (entry point or pause mid-flow)' },
  { kind: 'manualInput', label: 'Manual Input', icon: '✍️', description: 'Send pre-configured user message mid-flow' },
  { kind: 'newContext', label: 'New Context', icon: '🔀', description: 'Create new execution context with different model/provider' },
  { kind: 'llmRequest', label: 'LLM Request', icon: '💬', description: 'Send a request to the LLM' },
  { kind: 'tools', label: 'Tools', icon: '🔧', description: 'Provide tools to LLM (auto or specific list)' },
  { kind: 'injectMessages', label: 'Inject Messages', icon: '💉', description: 'Inject user/assistant message pair into conversation history' },
  { kind: 'intentRouter', label: 'Intent Router', icon: '🔀', description: 'Route based on LLM-classified user intent' },
  { kind: 'portalInput', label: 'Portal In', icon: '📥', description: 'Store data for portal output (reduces edge crossings)' },
  { kind: 'portalOutput', label: 'Portal Out', icon: '📤', description: 'Retrieve data from portal input (reduces edge crossings)' },
  { kind: 'parallelSplit', label: 'Split', icon: '⑂', description: 'Split flow into two parallel branches' },
  { kind: 'parallelJoin', label: 'Merge', icon: '🔗', description: 'Merge multiple inputs into one output' },
  { kind: 'cache', label: 'Cache', icon: '💾', description: 'Cache data to avoid re-executing expensive operations' },
  { kind: 'redactor', label: 'Redactor', icon: '🧹', description: 'Redact sensitive data' },
  { kind: 'budgetGuard', label: 'Budget Guard', icon: '💰', description: 'Monitor token budget' },
  { kind: 'errorDetection', label: 'Error Detection', icon: '⚠️', description: 'Detect error patterns' },
  { kind: 'approvalGate', label: 'Approval Gate', icon: '✅', description: 'Require manual approval' },
]




interface FlowCanvasPanelProps {}

export default function FlowCanvasPanel({}: FlowCanvasPanelProps) {
  const rfRef = useRef<any>(null)
  const reactFlowInstance = useReactFlow()

  // Use dispatch for actions
  const dispatch = useDispatch()

  // Get state values - use individual selectors to avoid re-render issues
  // For nodes, we use local state for smooth dragging, so we only get the initial value
  const storeNodes = useAppStore((s) => s.feNodes)
  const executionState = useAppStore((s) => s.feNodeExecutionState)
  const edges = useAppStore((s) => s.feEdges)
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
  const newProfileName = useAppStore((s) => s.feNewProfileName)
  const loadTemplateModalOpen = useAppStore((s) => s.feLoadTemplateModalOpen)

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
      dispatch('feSetSelectedTemplate', value)
      dispatch('feSetLoadTemplateModalOpen', true)
      return
    }

    // Load directly if no unsaved changes
    dispatch('feSetSelectedTemplate', value)
    dispatch('feLoadTemplate', value)
  }, [hasUnsavedChanges, dispatch])

  // Handle save as (create new profile)
  const handleSaveAs = useCallback(async () => {
    if (!newProfileName.trim()) return
    await dispatch('feSaveAsProfile', newProfileName)
  }, [newProfileName, dispatch])

  // Actually load the template/profile (called from modal)
  const loadSelectedTemplate = useCallback(async () => {
    if (!selectedTemplate) return
    await dispatch('feLoadTemplate', selectedTemplate)
    dispatch('feSetLoadTemplateModalOpen', false)
  }, [selectedTemplate, dispatch])

  // Handle modal cancel - revert selection to currently loaded flow
  const handleCancelLoad = useCallback(() => {
    // Revert selection to the currently loaded flow
    const currentlyLoaded = currentProfile || 'default'
    dispatch('feSetSelectedTemplate', currentlyLoaded)
    dispatch('feSetLoadTemplateModalOpen', false)
  }, [currentProfile, dispatch])

  // Auto-layout handler
  const handleAutoLayout = useCallback(() => {
    // Get current nodes and edges from store to avoid stale closure
    const currentNodes = storeNodes
    const currentEdges = edges
    const layoutedNodes = getLayoutedElements(currentNodes, currentEdges, 'LR')
    dispatch('feSetNodes', layoutedNodes)

    // Fit view after layout
    setTimeout(() => {
      rfRef.current?.fitView({ padding: 0.2, duration: 300 })
    }, 50)
  }, [storeNodes, edges, dispatch])

  // Local nodes state for ReactFlow - starts from store, updates during drag
  const [localNodes, setLocalNodes] = useState<FlowNode[]>([])

  // Track measured dimensions in a ref (doesn't trigger re-renders)
  const nodeDimensionsRef = useRef<Record<string, { width?: number; height?: number }>>({})

  // Sync from store when store changes
  useEffect(() => {
    if (!Array.isArray(storeNodes)) return

    // Merge execution state AND preserve ReactFlow's measured dimensions
    const merged = storeNodes.map(node => {
      const execState = executionState?.[node.id]
      const dims = nodeDimensionsRef.current[node.id]

      // CRITICAL: Preserve width/height from ref (ReactFlow sets these after measuring)
      // Without these, ReactFlow sets visibility:hidden
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
        },
      }
    })

    setLocalNodes(merged)
  }, [storeNodes, executionState])

  const uiNodes = localNodes

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

    // Apply ALL changes to local state immediately for smooth dragging
    setLocalNodes((nodes: FlowNode[]) => {
      const updated = applyNodeChanges(relevantChanges, nodes) as FlowNode[]
      // Also update dimensions ref from the updated nodes
      for (const node of updated) {
        if (node.width !== undefined && node.width !== null && node.height !== undefined && node.height !== null) {
          nodeDimensionsRef.current[node.id] = {
            width: node.width,
            height: node.height,
          }
        }
      }
      return updated
    })

    // Separate position changes from others
    const positionChanges = relevantChanges.filter(ch => ch.type === 'position') as any[]
    const otherChanges = relevantChanges.filter(ch => ch.type !== 'position')

    // Only dispatch position changes when drag ends
    const endedDrags = positionChanges.filter(ch => !ch.dragging)
    if (endedDrags.length > 0) {
      // Get final positions from local state
      setLocalNodes((nodes: FlowNode[]) => {
        const finalChanges = endedDrags.map(ch => {
          const node = nodes.find((n: FlowNode) => n.id === ch.id)
          return node ? { ...ch, position: node.position } : null
        }).filter(ch => ch && ch.position)

        if (finalChanges.length > 0) {
          dispatch('feApplyNodeChanges', finalChanges)
        }
        return nodes
      })
    }

    // Dispatch non-position changes immediately
    if (otherChanges.length > 0) {
      dispatch('feApplyNodeChanges', otherChanges)
    }
  }, [dispatch])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    // Compute new edges from current edges + changes
    const newEdges = changes.reduce((acc: any, change) => {
      if (change.type === 'remove') {
        return acc.filter((e: any) => e.id !== change.id)
      } else if (change.type === 'select') {
        return acc.map((e: any) => e.id === change.id ? { ...e, selected: change.selected } : e)
      }
      return acc
    }, edges)

    // Only dispatch if edges actually changed
    if (newEdges !== edges) {
      dispatch('feSetEdges', newEdges)
    }
  }, [edges, dispatch])

  const onConnect = useCallback((connection: Connection) => {
    const sourceHandle = connection.sourceHandle
    const targetHandle = connection.targetHandle

    // Find source node to determine context type
    const sourceNode = localNodes.find(n => n.id === connection.source)
    const sourceNodeKind = (sourceNode as any)?.data?.kind

    // Determine edge color based on handles and source node kind
    const color = getConnectionColorFromHandles(
      sourceHandle || undefined,
      targetHandle || undefined,
      sourceNodeKind
    )

    const newEdge = {
      id: `${connection.source}-${connection.target}-${sourceHandle || 'data'}-${targetHandle || 'data'}`,
      source: connection.source!,
      target: connection.target!,
      sourceHandle: sourceHandle || undefined,
      targetHandle: targetHandle || undefined,
      type: 'smoothstep',
      style: { stroke: color, strokeWidth: 2 },
      markerEnd: { type: 'arrowclosed' as any, color },
    }
    dispatch('feSetEdges', [...edges, newEdge])
  }, [edges, localNodes, dispatch])

  // Enhance edges with selection styling and handle-based colors
  const styledEdges = useMemo(() => {
    // Safety check: ensure edges is an array
    if (!Array.isArray(edges)) {
      return []
    }
    return edges.map(edge => {
      const sourceHandle = (edge as any).sourceHandle
      const targetHandle = (edge as any).targetHandle

      // Find source node to determine context type
      const sourceNode = localNodes.find(n => n.id === (edge as any).source)
      const sourceNodeKind = (sourceNode as any)?.data?.kind

      // Determine edge color based on handles and source node kind
      const color = getConnectionColorFromHandles(sourceHandle, targetHandle, sourceNodeKind)

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
  }, [edges, localNodes])

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

              <Divider my={4} />

              {/* CRUD operations section */}
              <Menu.Label>Actions</Menu.Label>

              <Menu.Item
                leftSection={<IconPlus size={14} />}
                onClick={() => dispatch('feSetSaveAsModalOpen', true)}
                style={{ fontSize: 12 }}
              >
                Save As New...
              </Menu.Item>

              {selectedTemplate && !isSystemTemplate(selectedTemplate) && (
                <>
                  <Menu.Item
                    leftSection={<IconCopy size={14} />}
                    onClick={() => {
                      // Duplicate: open save as with current name + " Copy"
                      const currentName = availableTemplates?.find((t: any) => t.id === selectedTemplate)?.name || selectedTemplate
                      dispatch('feSetNewProfileName', `${currentName} Copy`)
                      dispatch('feSetSaveAsModalOpen', true)
                    }}
                    style={{ fontSize: 12 }}
                  >
                    Duplicate
                  </Menu.Item>

                  <Menu.Item
                    leftSection={<IconTrash size={14} />}
                    color="red"
                    onClick={async () => {
                      if (confirm(`Delete profile "${selectedTemplate}"?`)) {
                        await dispatch('feDeleteProfile', selectedTemplate)
                      }
                    }}
                    style={{ fontSize: 12 }}
                  >
                    Delete
                  </Menu.Item>
                </>
              )}
            </Menu.Dropdown>
          </Menu>

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

          {/* Auto-layout button */}
          <Button
            size="xs"
            leftSection={<IconLayoutDistributeVertical size={14} />}
            onClick={handleAutoLayout}
            variant="subtle"
            color="gray"
            title="Auto-layout nodes"
          >
            Auto Layout
          </Button>

          {status === 'running' && <Badge size="sm" color="green">Running</Badge>}
          {status === 'waitingForInput' && (
            <Badge size="sm" color="yellow">
              Waiting{pausedNode ? ` at ${pausedNode}` : ''}
            </Badge>
          )}
        </Group>

        <Group gap="xs">
          {status === 'running' && (
            <>
              <Button
                size="xs"
                leftSection={<IconPlayerStop size={14} />}
                onClick={() => dispatch('feStop')}
                variant="filled"
                color="red"
              >
                Stop
              </Button>
            </>
          )}
          {status === 'waitingForInput' && (
            <>
              <Button
                size="xs"
                leftSection={<IconPlayerStop size={14} />}
                onClick={() => dispatch('feStop')}
                variant="filled"
                color="red"
              >
                Stop
              </Button>
            </>
          )}
          {status === 'stopped' && (
            <Button
              size="xs"
              leftSection={<IconRefresh size={14} />}
              onClick={() => dispatch('flowInit')}
              variant="filled"
              color="blue"
            >
              Restart
            </Button>
          )}
        </Group>
      </div>

      {/* Save As Modal */}
      <Modal
        opened={saveAsModalOpen}
        onClose={() => {
          dispatch('feSetSaveAsModalOpen', false)
          dispatch('feSetNewProfileName', '')
        }}
        title="Save Flow Profile As"
        size="sm"
      >
        <TextInput
          label="Profile Name"
          placeholder="Enter profile name"
          value={newProfileName}
          onChange={(e) => dispatch('feSetNewProfileName', e.currentTarget.value)}
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
              dispatch('feSetSaveAsModalOpen', false)
              dispatch('feSetNewProfileName', '')
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSaveAs}
            disabled={!newProfileName.trim()}
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
          nodes={uiNodes as FlowNode[]}
          edges={styledEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={(event) => {
            event.preventDefault()
            const kind = event.dataTransfer.getData('application/reactflow')
            if (!kind) return

            // Get the ReactFlow wrapper bounds

            // Calculate position in flow coordinates using screenToFlowPosition
            const position = reactFlowInstance.screenToFlowPosition({
              x: event.clientX,
              y: event.clientY,
            })


            const match = NODE_PALETTE.find((p) => p.kind === kind)
            const label = match?.label || kind
            dispatch('feAddNode', { kind, pos: position, label })
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
          style={{ background: '#1e1e1e' }}
          deleteKeyCode={['Backspace', 'Delete']}
          selectionKeyCode={null}
        >
          <Background color="#333" gap={16} />
          <Controls />
          <MiniMap
            style={{ background: '#252526', border: '1px solid #3e3e42' }}
            nodeColor={(node) => {
              const kind = (node.data as any)?.kind
              return getNodeColor(kind)
            }}
          />
        </ReactFlow>
      </div>
    </div>
  )
}

