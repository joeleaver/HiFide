import { useCallback, useEffect, useMemo, type ChangeEvent } from 'react'
import { Accordion, Checkbox, Text } from '@mantine/core'
import { useFlowToolsStore } from '../../../store/flowTools'
import type { FlowToolsState, ToolDefinition } from '../../../store/flowTools'
import { useBackendBinding } from '../../../store/binding'
import type { BackendBindingState } from '../../../store/binding'

interface ToolsConfigProps {
  config: any
  onConfigChange: (patch: any) => void
}

interface AccordionGroup {
  key: string
  label: string
  tools: ToolDefinition[]
  subtitle?: string
}

const GROUP_LABELS: Record<string, string> = {
  agent: '🤖 Agent (Self-regulation)',
  fs: '📁 Filesystem',
  edits: '✏️ Code Editing',
  index: '🔍 Search',
  terminal: '💻 Terminal',
  code: '🔧 Code Analysis',
  workspace: '🗂️ Workspace',
  project: '📋 Project Management',
  human: '👤 Human Interaction',
  mcp: '🔌 MCP Tools',
  other: '📦 Other',
}

export function ToolsConfig({ config, onConfigChange }: ToolsConfigProps) {
  const workspaceId = useBackendBinding((state: BackendBindingState) => state.workspaceId)
  const { status, tools, mcpServers, hydrate } = useFlowToolsStore((state: FlowToolsState) => ({
    status: state.status,
    tools: state.tools,
    mcpServers: state.mcpServers,
    hydrate: state.hydrate,
  }))

  useEffect(() => {
    if (!workspaceId) return
    void hydrate({ workspaceId })
  }, [workspaceId, hydrate])

  const groupedTools = useMemo(() => {
    const groups: Record<string, typeof tools> = {}
    tools.forEach((tool) => {
      const n = tool.name || ''
      const lc = n.toLowerCase()
      const cat = tool.category
        || (n === 'knowledgeBaseStore' || n === 'knowledgeBaseSearch' ? 'workspace'
        : n === 'askForInput' ? 'human'
        : n.startsWith('fs') ? 'fs'
        : n.startsWith('agent') ? 'agent'
        : n.startsWith('workspace') || n.startsWith('knowledgeBase') ? 'workspace'
        : n.startsWith('terminal') || n.startsWith('session') ? 'terminal'
        : n.startsWith('mcp') ? 'mcp'
        : lc.includes('applyedits') || lc.includes('patch') ? 'edits'
        : lc.includes('grep') || lc.includes('search') ? 'index'
        : lc.includes('ast') || n.startsWith('replace') ? 'code'
        : 'other')
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(tool)
    })
    return groups
  }, [tools])

  const isAuto = config.tools === 'auto'
  const rawSelectedTools: string[] = Array.isArray(config.tools)
    ? config.tools.filter((toolName: unknown): toolName is string => typeof toolName === 'string')
    : []
  const legacyMcpEnabled = config.mcpEnabled !== false
  const mcpPluginOverrides = isPlainObject<Record<string, boolean>>(config.mcpPlugins) ? config.mcpPlugins : undefined

  const nonMcpSelectedTools = useMemo<string[]>(() => {
    return rawSelectedTools.filter((toolName) => !isMcpToolName(toolName))
  }, [rawSelectedTools])

  const mcpSelectedTools = useMemo<string[]>(() => {
    return rawSelectedTools.filter(isMcpToolName)
  }, [rawSelectedTools])

  const isPluginEnabled = useCallback((pluginId?: string | null) => {
    if (!pluginId) return true
    if (mcpPluginOverrides && Object.prototype.hasOwnProperty.call(mcpPluginOverrides, pluginId)) {
      return mcpPluginOverrides[pluginId] !== false
    }
    return legacyMcpEnabled
  }, [mcpPluginOverrides, legacyMcpEnabled])

  const { mcp: _legacyMcpGroup, ...nonMcpGroups } = groupedTools

  const mcpPlugins = useMemo(() => {
    return mcpServers
      .map((server) => ({
        pluginId: server.slug,
        label: server.label,
        status: server.status,
        globallyEnabled: server.enabled,
        tools: server.tools,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  }, [mcpServers])

  const pluginToolNameMap = useMemo(() => {
    const map = new Map<string, string[]>()
    mcpPlugins.forEach(({ pluginId, tools: pluginTools }) => {
      if (!pluginId || !Array.isArray(pluginTools) || pluginTools.length === 0) return
      const names = pluginTools
        .map((tool) => normalizeMcpToolName(pluginId, tool))
        .filter((name): name is string => typeof name === 'string' && isMcpToolName(name))
      if (names.length) {
        map.set(pluginId, Array.from(new Set(names)))
      }
    })
    return map
  }, [mcpPlugins])

  useEffect(() => {
    if (isAuto) return
    if (!pluginToolNameMap.size) {
      if (mcpSelectedTools.length > 0) {
        onConfigChange({ tools: [...nonMcpSelectedTools] })
      }
      return
    }

    const desiredMcpTools = new Set<string>()
    mcpPlugins.forEach(({ pluginId }) => {
      if (!pluginId) return
      if (!isPluginEnabled(pluginId)) return
      const names = pluginToolNameMap.get(pluginId)
      names?.forEach((name) => desiredMcpTools.add(name))
    })

    const currentSet = new Set(mcpSelectedTools)
    let changed = false

    if (currentSet.size !== desiredMcpTools.size) {
      changed = true
    } else {
      for (const name of desiredMcpTools) {
        if (!currentSet.has(name)) {
          changed = true
          break
        }
      }
    }

    if (!changed) return

    const merged = mergeToolSelections(nonMcpSelectedTools, Array.from(desiredMcpTools).sort())
    onConfigChange({ tools: merged })
  }, [isAuto, nonMcpSelectedTools, mcpSelectedTools, mcpPlugins, pluginToolNameMap, isPluginEnabled, onConfigChange])

  const selectedTools = nonMcpSelectedTools

  const accordionGroups: AccordionGroup[] = useMemo(() => {
    const baseGroups: AccordionGroup[] = Object.entries(nonMcpGroups)
      .filter(([, toolsInGroup]) => Array.isArray(toolsInGroup) && toolsInGroup.length > 0)
      .map(([groupName, toolsInGroup]) => ({
        key: groupName,
        label: GROUP_LABELS[groupName] || groupName,
        tools: toolsInGroup
      }))

    return baseGroups
  }, [nonMcpGroups])

  const handleAutoToggle = () => {
    onConfigChange({ tools: isAuto ? [] : 'auto' })
  }

  const handleMcpPluginToggle = (pluginId: string) => (event: ChangeEvent<HTMLInputElement>) => {
    const currentOverrides = isPlainObject<Record<string, boolean>>(config.mcpPlugins) ? config.mcpPlugins : {}
    const next = { ...currentOverrides, [pluginId]: event.currentTarget.checked }
    onConfigChange({ mcpPlugins: next })
  }

  const handleToolToggle = (toolName: string) => {
    if (isAuto) return
    const next = selectedTools.includes(toolName)
      ? selectedTools.filter((t: string) => t !== toolName)
      : [...selectedTools, toolName]
    const merged = mergeToolSelections(next, mcpSelectedTools)
    onConfigChange({ tools: merged })
  }

  const handleGroupToggle = (groupTools: ToolDefinition[]) => {
    if (isAuto) return
    const group = groupTools.map((t) => t.name)
    const allSelected = group.every((t) => selectedTools.includes(t))
    const next = allSelected
      ? selectedTools.filter((t: string) => !group.includes(t))
      : [...new Set([...selectedTools, ...group])]
    const merged = mergeToolSelections(next, mcpSelectedTools)
    onConfigChange({ tools: merged })
  }

  if (status === 'loading') {
    return (
      <div style={wrapperStyle}>
        <Text size="xs" c="dimmed">Loading tools...</Text>
      </div>
    )
  }


  return (
    <div style={wrapperStyle}>
      <Text size="xs" c="dimmed" style={{ fontSize: 9, lineHeight: 1.3, marginBottom: 8 }}>
        🔧 Provides tools to the LLM. Select "Auto" for all tools, or choose specific tools below.
      </Text>

      <Checkbox
        label="Auto (All Tools)"
        checked={isAuto}
        onChange={handleAutoToggle}
        size="xs"
        styles={{ root: { marginBottom: 12 }, label: { fontSize: 11, fontWeight: 600, color: '#e0e0e0' } }}
      />

      {!!mcpPlugins.length && (
        <div style={mcpSectionStyle}>
          <div>
            <Text size="xs" style={{ fontSize: 10, fontWeight: 600 }}>
              {GROUP_LABELS.mcp}
            </Text>
            <Text size="xs" c="dimmed" style={{ fontSize: 9, marginTop: 2 }}>
              Toggle access to each MCP plugin to enable or disable all of its tools for this workspace.
            </Text>
          </div>
          <div style={mcpPluginListStyle}>
            {mcpPlugins.map(({ pluginId, label, tools, globallyEnabled, status }, index) => {
              const enabled = isPluginEnabled(pluginId)
              const toolCountLabel = `${tools.length} tool${tools.length === 1 ? '' : 's'}`
              const statusLabel = status.charAt(0).toUpperCase() + status.slice(1)
              return (
                <div
                  key={pluginId}
                  style={{
                    ...mcpPluginRowStyle,
                    borderBottom: index === mcpPlugins.length - 1 ? 'none' : '1px solid #2f2f2f'
                  }}
                >
                  <div>
                    <Text size="xs" style={{ fontSize: 10, fontWeight: 600 }}>{label}</Text>
                    <Text size="xs" c="dimmed" style={{ fontSize: 9, marginTop: 2 }}>
                      {globallyEnabled ? `${toolCountLabel} · ${statusLabel}` : 'Disabled in MCP settings'}
                    </Text>
                    {!globallyEnabled && (
                      <Text size="xs" c="red" style={{ fontSize: 9 }}>
                        Enable this server from the MCP screen to make its tools available.
                      </Text>
                    )}
                  </div>
                  <Checkbox
                    label={enabled ? 'Included' : 'Excluded'}
                    checked={enabled}
                    onChange={handleMcpPluginToggle(pluginId)}
                    disabled={!globallyEnabled}
                    size="xs"
                    styles={{
                      label: { fontSize: 10, fontWeight: 600, color: enabled ? '#e0e0e0' : '#c94c4c' }
                    }}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!isAuto && accordionGroups.length > 0 && (
        <Accordion
          variant="separated"
          styles={{
            root: { background: 'transparent' },
            item: { background: '#252526', border: '1px solid #3e3e42', marginBottom: 4 },
            control: { padding: '6px 8px', fontSize: 10 },
            label: { fontSize: 10, fontWeight: 600 },
            content: { padding: '4px 8px' },
          }}
        >
          {accordionGroups.map((group) => {
            const allSelected = group.tools.every((t) => selectedTools.includes(t.name))
            const someSelected = group.tools.some((t) => selectedTools.includes(t.name))

            return (
              <Accordion.Item key={group.key} value={group.key}>
                <Accordion.Control>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      onChange={() => handleGroupToggle(group.tools)}
                      size="xs"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                      <span>{group.label}</span>
                      {group.subtitle && (
                        <span style={{ fontSize: 9, color: '#888' }}>{group.subtitle}</span>
                      )}
                    </div>
                    <span style={{ marginLeft: 'auto', fontSize: 9, color: '#888' }}>
                      {group.tools.filter((t) => selectedTools.includes(t.name)).length}/{group.tools.length}
                    </span>
                  </div>
                </Accordion.Control>
                <Accordion.Panel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {group.tools.map((tool) => (
                      <Checkbox
                        key={tool.name}
                        label={
                          <div style={{ fontSize: 9 }}>
                            <div style={{ fontWeight: 500, color: '#e0e0e0' }}>{tool.name}</div>
                            {tool.description && (
                              <div style={{ color: '#888', marginTop: 2 }}>{tool.description}</div>
                            )}
                          </div>
                        }
                        checked={selectedTools.includes(tool.name)}
                        onChange={() => handleToolToggle(tool.name)}
                        size="xs"
                        styles={{ root: { marginBottom: 4 }, body: { alignItems: 'flex-start' } }}
                      />
                    ))}
                  </div>
                </Accordion.Panel>
              </Accordion.Item>
            )
          })}
        </Accordion>
      )}

      {!isAuto && (
        <Text size="xs" c="dimmed" style={{ fontSize: 9, marginTop: 8 }}>
          Selected: {selectedTools.length} tool{selectedTools.length !== 1 ? 's' : ''}
        </Text>
      )}
    </div>
  )
}

const wrapperStyle = {
  padding: 10,
  background: '#1e1e1e',
  borderTop: '1px solid #333',
  fontSize: 11,
}

const mcpSectionStyle = {
  border: '1px solid #3e3e42',
  borderRadius: 6,
  padding: 10,
  background: '#252526',
  marginBottom: 12,
}

const mcpPluginListStyle = {
  marginTop: 8,
  display: 'flex',
  flexDirection: 'column' as const,
}

const mcpPluginRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '6px 0',
}

function isPlainObject<T extends Record<string, unknown> = Record<string, unknown>>(value: unknown): value is T {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMcpToolName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return value.startsWith('mcp_') || value.startsWith('mcp.')
}

function mergeToolSelections(baseTools: string[], mcpTools: Iterable<string>): string[] {
  const seen = new Set<string>()
  const merged: string[] = []

  for (const name of baseTools) {
    if (typeof name === 'string' && !seen.has(name)) {
      seen.add(name)
      merged.push(name)
    }
  }

  for (const name of mcpTools) {
    if (typeof name === 'string' && !seen.has(name)) {
      seen.add(name)
      merged.push(name)
    }
  }

  return merged
}

function normalizeMcpToolName(
  pluginId: string,
  tool: { fullName?: string | null; name?: string | null }
): string | null {
  const explicit = typeof tool?.fullName === 'string' ? tool.fullName : null
  if (explicit && isMcpToolName(explicit)) {
    return explicit
  }

  const rawName = typeof tool?.name === 'string' ? tool.name.trim() : ''
  if (!rawName) return null
  const sanitized = rawName
    .replace(/\s+/g, '_')
    .replace(/\./g, '_')
  return `mcp_${pluginId}_${sanitized}`
}



