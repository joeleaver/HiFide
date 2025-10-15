import { useRef, useMemo, useCallback } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useAppStore } from '../store'
import { Button, Group, Badge, ActionIcon, TextInput, Modal, Text, Menu, Divider } from '@mantine/core'
import { IconPlayerStop, IconChevronRight, IconChevronLeft, IconLayoutDistributeVertical, IconChevronDown, IconPlus, IconCopy, IconTrash, IconRefresh } from '@tabler/icons-react'
import FlowNode from './FlowNode'
import { isSystemTemplate } from '../services/flowProfiles'
import { getLayoutedElements } from '../utils/autoLayout'

const nodeTypes = { hifiNode: FlowNode }

// Node palette definitions (excludes defaultContextStart - always present, can't be added/removed)
const NODE_PALETTE: Array<{ kind: string; label: string; icon: string; description: string }> = [
  { kind: 'userInput', label: 'User Input', icon: '👤', description: 'Accept user input (entry point or pause mid-flow)' },
  { kind: 'manualInput', label: 'Manual Input', icon: '✍️', description: 'Send pre-configured user message mid-flow' },
  { kind: 'newContext', label: 'New Context', icon: '🔀', description: 'Create new execution context with different model/provider' },
  { kind: 'chat', label: 'LLM Message', icon: '💬', description: 'LLM conversation' },
  { kind: 'tools', label: 'Tools', icon: '🔧', description: 'Provide tools to LLM (auto or specific list)' },
  { kind: 'intentRouter', label: 'Intent Router', icon: '🔀', description: 'Route based on LLM-classified user intent' },
  { kind: 'parallelSplit', label: 'Split', icon: '⑂', description: 'Split flow into two parallel branches' },
  { kind: 'parallelJoin', label: 'Merge', icon: '🔗', description: 'Merge multiple inputs into one output' },
  { kind: 'redactor', label: 'Redactor', icon: '🧹', description: 'Redact sensitive data' },
  { kind: 'budgetGuard', label: 'Budget Guard', icon: '💰', description: 'Monitor token budget' },
  { kind: 'errorDetection', label: 'Error Detection', icon: '⚠️', description: 'Detect error patterns' },
  { kind: 'approvalGate', label: 'Approval Gate', icon: '✅', description: 'Require manual approval' },
]

// Color map for node palette
const KIND_COLORS: Record<string, string> = {
  defaultContextStart: '#3b82f6',
  userInput: '#4a9eff',
  manualInput: '#06b6d4',
  newContext: '#9b59b6',
  chat: '#a855f7',
  redactor: '#14b8a6',
  budgetGuard: '#f59e0b',
  errorDetection: '#f97316',
  approvalGate: '#ef4444',
  parallelSplit: '#8b5cf6',
  parallelJoin: '#10b981',
  intentRouter: '#f39c12',
}

interface FlowCanvasPanelProps {
  collapsed: boolean
  onToggleCollapse: () => void
  width: number
  onResize: (width: number) => void
}

export default function FlowCanvasPanel({ collapsed, onToggleCollapse, width, onResize }: FlowCanvasPanelProps) {
  const rfRef = useRef<any>(null)
  const resizeRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)

  // Get state values - use individual selectors to avoid re-render issues
  const nodes = useAppStore((s) => s.feNodes)
  const edges = useAppStore((s) => s.feEdges)
  const status = useAppStore((s) => s.feStatus)
  const pausedNode = useAppStore((s) => s.fePausedNode)
  const currentProfile = useAppStore((s) => s.feCurrentProfile)
  const availableTemplates = useAppStore((s) => s.feAvailableTemplates)
  const templatesLoaded = useAppStore((s) => s.feTemplatesLoaded)
  const selectedTemplate = useAppStore((s) => s.feSelectedTemplate)
  const hasUnsavedChanges = useAppStore((s) => s.feHasUnsavedChanges)
  const saveAsModalOpen = useAppStore((s) => s.feSaveAsModalOpen)
  const newProfileName = useAppStore((s) => s.feNewProfileName)
  const loadTemplateModalOpen = useAppStore((s) => s.feLoadTemplateModalOpen)

  // Get action functions separately (these are stable references)
  const setNodes = useAppStore((s) => s.feSetNodes)
  const setEdges = useAppStore((s) => s.feSetEdges)
  const addNode = useAppStore((s) => s.feAddNode)
  const updateNodePosition = useAppStore((s) => s.feUpdateNodePosition)
  const stop = useAppStore((s) => s.feStop)
  const feInit = useAppStore((s) => s.feInit)
  const loadTemplate = useAppStore((s) => s.feLoadTemplate)
  const saveAsProfile = useAppStore((s) => s.feSaveAsProfile)
  const deleteProfile = useAppStore((s) => s.feDeleteProfile)
  const setSelectedTemplate = useAppStore((s) => s.feSetSelectedTemplate)
  const setSaveAsModalOpen = useAppStore((s) => s.feSetSaveAsModalOpen)
  const setNewProfileName = useAppStore((s) => s.feSetNewProfileName)
  const setLoadTemplateModalOpen = useAppStore((s) => s.feSetLoadTemplateModalOpen)

  // Memoize template options for Select component
  const templateOptions = useMemo(() => {
    if (!availableTemplates || availableTemplates.length === 0) {
      return []
    }

    try {
      // Separate system and user templates
      const systemTemplates: Array<{ value: string; label: string }> = []
      const userTemplates: Array<{ value: string; label: string }> = []

      availableTemplates.forEach(template => {
        if (!template || !template.id || !template.name) {
          console.warn('Invalid template:', template)
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
      setSelectedTemplate(value)
      setLoadTemplateModalOpen(true)
      return
    }

    // Load directly if no unsaved changes
    setSelectedTemplate(value)
    loadTemplate(value)
  }, [hasUnsavedChanges, setSelectedTemplate, setLoadTemplateModalOpen, loadTemplate])

  // Handle save as (create new profile)
  const handleSaveAs = useCallback(async () => {
    if (!newProfileName.trim()) return
    await saveAsProfile(newProfileName)
  }, [newProfileName, saveAsProfile])

  // Actually load the template/profile (called from modal)
  const loadSelectedTemplate = useCallback(async () => {
    if (!selectedTemplate) return
    await loadTemplate(selectedTemplate)
    setLoadTemplateModalOpen(false)
  }, [selectedTemplate, loadTemplate, setLoadTemplateModalOpen])

  // Handle modal cancel - revert selection to currently loaded flow
  const handleCancelLoad = useCallback(() => {
    // Revert selection to the currently loaded flow
    const currentlyLoaded = currentProfile || 'default'
    setSelectedTemplate(currentlyLoaded)
    setLoadTemplateModalOpen(false)
  }, [currentProfile, setSelectedTemplate, setLoadTemplateModalOpen])

  // Auto-layout handler
  const handleAutoLayout = useCallback(() => {
    // Get current nodes and edges from store to avoid stale closure
    const currentNodes = nodes
    const currentEdges = edges
    const layoutedNodes = getLayoutedElements(currentNodes, currentEdges, 'LR')
    setNodes(layoutedNodes)

    // Fit view after layout
    setTimeout(() => {
      rfRef.current?.fitView({ padding: 0.2, duration: 300 })
    }, 50)
  }, [nodes, edges, setNodes])

  // Prepare nodes for UI
  const uiNodes = useMemo(() => {
    // Safety check: ensure nodes is an array
    if (!Array.isArray(nodes)) {
      console.warn('[FlowCanvasPanel] nodes is not an array:', nodes)
      return []
    }
    return nodes
  }, [nodes])
  
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Filter out dimension changes which can cause infinite loops
    const relevantChanges = changes.filter(change =>
      change.type !== 'dimensions'
    )

    if (relevantChanges.length === 0) return

    // Update positions in store
    relevantChanges.forEach((change) => {
      if (change.type === 'position' && change.position && !change.dragging) {
        updateNodePosition(change.id, change.position)
      }
    })

    // Apply all changes using functional update to avoid dependency on nodes
    setNodes((currentNodes) => {
      let newNodes = [...currentNodes]
      relevantChanges.forEach((change) => {
        if (change.type === 'remove') {
          newNodes = newNodes.filter(n => n.id !== change.id)
        } else if (change.type === 'select') {
          newNodes = newNodes.map(n => n.id === change.id ? { ...n, selected: change.selected } : n)
        } else if (change.type === 'position' && change.position) {
          newNodes = newNodes.map(n => n.id === change.id ? { ...n, position: change.position! } : n)
        }
      })
      return newNodes
    })
  }, [setNodes, updateNodePosition])
  
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((currentEdges) => {
      return changes.reduce((acc, change) => {
        if (change.type === 'remove') {
          return acc.filter(e => e.id !== change.id)
        } else if (change.type === 'select') {
          return acc.map(e => e.id === change.id ? { ...e, selected: change.selected } : e)
        }
        return acc
      }, currentEdges)
    })
  }, [setEdges])

  const onConnect = useCallback((connection: Connection) => {
    const sourceHandle = connection.sourceHandle
    const targetHandle = connection.targetHandle

    // Determine edge color based on handles
    let color = '#666' // Default gray
    if (sourceHandle === 'context' || targetHandle === 'context' || targetHandle === 'input') {
      color = '#9b59b6' // Purple for context edges
    } else if (targetHandle === 'tools') {
      color = '#f97316' // Orange for tools edges
    } else if (sourceHandle === 'result' || sourceHandle === 'data') {
      color = '#2ecc71' // Green for result/data edges
    }

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
    setEdges((currentEdges) => [...currentEdges, newEdge])
  }, [setEdges])

  // Enhance edges with selection styling and handle-based colors
  const styledEdges = useMemo(() => {
    // Safety check: ensure edges is an array
    if (!Array.isArray(edges)) {
      console.warn('[FlowCanvasPanel] edges is not an array:', edges)
      return []
    }
    return edges.map(edge => {
      const sourceHandle = (edge as any).sourceHandle
      const targetHandle = (edge as any).targetHandle

      // Determine edge color based on handles
      let color = '#666' // Default gray
      if (sourceHandle === 'context' || targetHandle === 'context' || targetHandle === 'input') {
        color = '#9b59b6' // Purple for context edges
      } else if (targetHandle === 'tools') {
        color = '#f97316' // Orange for tools edges
      } else if (sourceHandle === 'result' || sourceHandle === 'data') {
        color = '#2ecc71' // Green for result/data edges
      }

      return {
        ...edge,
        type: 'smoothstep',
        animated: false,
        style: edge.selected
          ? { stroke: '#007acc', strokeWidth: 3 }
          : { stroke: color, strokeWidth: 2 },
        markerEnd: {
          type: 'arrowclosed' as any,
          color: edge.selected ? '#007acc' : color
        },
      }
    })
  }, [edges])

  // Handle resize drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true
    e.preventDefault()

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      const newWidth = window.innerWidth - e.clientX
      if (newWidth >= 200 && newWidth <= 1200) {
        onResize(newWidth)
      }
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [onResize])

  if (collapsed) {
    return (
      <div style={{ 
        width: 40, 
        background: '#252526', 
        borderLeft: '1px solid #3e3e42',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 12
      }}>
        <ActionIcon
          onClick={onToggleCollapse}
          variant="subtle"
          color="gray"
          title="Expand flow canvas"
        >
          <IconChevronLeft size={18} />
        </ActionIcon>
      </div>
    )
  }
  
  return (
    <div style={{
      width,
      display: 'flex',
      flexDirection: 'column',
      borderLeft: '1px solid #3e3e42',
      background: '#1e1e1e',
      position: 'relative'
    }}>
      {/* Resize handle */}
      <div
        ref={resizeRef}
        onMouseDown={handleMouseDown}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          cursor: 'ew-resize',
          zIndex: 10,
          background: 'transparent',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#007acc'
        }}
        onMouseLeave={(e) => {
          if (!isDraggingRef.current) {
            e.currentTarget.style.background = 'transparent'
          }
        }}
      />
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
          <ActionIcon
            onClick={onToggleCollapse}
            variant="subtle"
            color="gray"
            size="sm"
            title="Collapse flow canvas"
          >
            <IconChevronRight size={16} />
          </ActionIcon>

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
                onClick={() => setSaveAsModalOpen(true)}
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
                      const currentName = availableTemplates?.find(t => t.id === selectedTemplate)?.name || selectedTemplate
                      setNewProfileName(`${currentName} Copy`)
                      setSaveAsModalOpen(true)
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
                        await deleteProfile(selectedTemplate)
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
          {(status === 'paused' || status === 'waitingForInput') && (
            <Badge size="sm" color="yellow">
              {status === 'waitingForInput' ? 'Waiting' : 'Paused'}
              {pausedNode ? ` at ${pausedNode}` : ''}
            </Badge>
          )}
        </Group>

        <Group gap="xs">
          {status === 'running' && (
            <>
              <Button
                size="xs"
                leftSection={<IconPlayerStop size={14} />}
                onClick={stop}
                variant="filled"
                color="red"
              >
                Stop
              </Button>
            </>
          )}
          {(status === 'paused' || status === 'waitingForInput') && (
            <>
              <Button
                size="xs"
                leftSection={<IconPlayerStop size={14} />}
                onClick={stop}
                variant="filled"
                color="red"
              >
                Stop
              </Button>
            </>
          )}
          {status !== 'running' && status !== 'paused' && status !== 'waitingForInput' && (
            <Button
              size="xs"
              leftSection={<IconRefresh size={14} />}
              onClick={feInit}
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
          setSaveAsModalOpen(false)
          setNewProfileName('')
        }}
        title="Save Flow Profile As"
        size="sm"
      >
        <TextInput
          label="Profile Name"
          placeholder="Enter profile name"
          value={newProfileName}
          onChange={(e) => setNewProfileName(e.currentTarget.value)}
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
              setSaveAsModalOpen(false)
              setNewProfileName('')
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
        {/* Floating Node Palette */}
        <div style={{
          position: 'absolute',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          background: '#252526',
          border: '1px solid #3e3e42',
          borderRadius: 8,
          padding: '8px 12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          maxWidth: '90%',
          overflowX: 'auto'
        }}>
          <Text size="xs" fw={600} c="dimmed" style={{ marginRight: 4 }}>Add Node:</Text>
          {NODE_PALETTE.map((p) => (
            <div
              key={p.kind}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/reactflow', p.kind)
                e.dataTransfer.effectAllowed = 'move'
              }}
              style={{
                padding: '6px 12px',
                background: KIND_COLORS[p.kind] || '#4a4a4a',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                cursor: 'grab',
                color: '#ffffff',
                fontSize: 12,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)'
              }}
              title={p.description}
            >
              <span style={{ fontSize: 14 }}>{p.icon}</span>
              <span>{p.label}</span>
            </div>
          ))}
        </div>

        <ReactFlow
          ref={rfRef}
          nodes={uiNodes}
          edges={styledEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={(event) => {
            event.preventDefault()
            const kind = event.dataTransfer.getData('application/reactflow')
            if (!kind) return
            const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
            const point = rfRef.current?.project
              ? rfRef.current.project({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })
              : { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
            const match = NODE_PALETTE.find((p) => p.kind === kind)
            const label = match?.label || kind
            addNode(kind, point, label)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
          }}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={{
            type: 'smoothstep',
            animated: false,
            style: { stroke: '#666', strokeWidth: 2 },
            markerEnd: { type: 'arrowclosed' as any, color: '#666' }
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
              const colors: Record<string, string> = {
                userMessage: '#4a9eff',
                chat: '#a855f7',
                redactor: '#14b8a6',
                budgetGuard: '#f59e0b',
                errorDetection: '#f97316',
                approvalGate: '#ef4444',
              }
              return colors[kind] || '#808080'
            }}
          />
        </ReactFlow>
      </div>
    </div>
  )
}

