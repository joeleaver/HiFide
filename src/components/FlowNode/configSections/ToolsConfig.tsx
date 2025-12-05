import { useMemo } from 'react'
import { Accordion, Checkbox, Text } from '@mantine/core'
import { useFlowToolsStore } from '../../../store/flowTools'

interface ToolsConfigProps {
  config: any
  onConfigChange: (patch: any) => void
}

export function ToolsConfig({ config, onConfigChange }: ToolsConfigProps) {
  const { status, tools, hydrate } = useFlowToolsStore((s) => ({ status: s.status, tools: s.tools, hydrate: s.hydrate }))

  if (status === 'idle') {
    void hydrate()
  }

  const groupedTools = useMemo(() => {
    const groups: Record<string, typeof tools> = {}
    tools.forEach((tool) => {
      const n = tool.name || ''
      const lc = n.toLowerCase()
      const cat = tool.category
        || (n === 'knowledgeBaseStore' || n === 'knowledgeBaseSearch' ? 'workspace'
        : n.startsWith('fs') ? 'fs'
        : n.startsWith('agent') ? 'agent'
        : n.startsWith('workspace') || n.startsWith('knowledgeBase') ? 'workspace'
        : n.startsWith('terminal') || n.startsWith('session') ? 'terminal'
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
  const selectedTools = Array.isArray(config.tools) ? config.tools : []

  const handleAutoToggle = () => {
    onConfigChange({ tools: isAuto ? [] : 'auto' })
  }

  const handleToolToggle = (toolName: string) => {
    if (isAuto) return
    const next = selectedTools.includes(toolName)
      ? selectedTools.filter((t: string) => t !== toolName)
      : [...selectedTools, toolName]
    onConfigChange({ tools: next })
  }

  const handleGroupToggle = (groupName: string) => {
    if (isAuto) return
    const group = groupedTools[groupName].map((t) => t.name)
    const allSelected = group.every((t) => selectedTools.includes(t))
    const next = allSelected
      ? selectedTools.filter((t: string) => !group.includes(t))
      : [...new Set([...selectedTools, ...group])]
    onConfigChange({ tools: next })
  }

  if (status === 'loading') {
    return (
      <div style={wrapperStyle}>
        <Text size="xs" c="dimmed">Loading tools...</Text>
      </div>
    )
  }

  const groupLabels: Record<string, string> = {
    agent: '🤖 Agent (Self-regulation)',
    fs: '📁 Filesystem',
    edits: '✏️ Code Editing',
    index: '🔍 Search',
    terminal: '💻 Terminal',
    code: '🔧 Code Analysis',
    workspace: '🗂️ Workspace',
    project: '📋 Project Management',
    other: '📦 Other',
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

      {!isAuto && (
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
          {Object.entries(groupedTools).map(([groupName, toolsInGroup]) => {
            const allSelected = toolsInGroup.every((t) => selectedTools.includes(t.name))
            const someSelected = toolsInGroup.some((t) => selectedTools.includes(t.name))

            return (
              <Accordion.Item key={groupName} value={groupName}>
                <Accordion.Control>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      onChange={() => handleGroupToggle(groupName)}
                      size="xs"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span>{groupLabels[groupName] || groupName}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 9, color: '#888' }}>
                      {toolsInGroup.filter((t) => selectedTools.includes(t.name)).length}/{toolsInGroup.length}
                    </span>
                  </div>
                </Accordion.Control>
                <Accordion.Panel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {toolsInGroup.map((tool) => (
                      <Checkbox
                        key={tool.name}
                        label={
                          <div style={{ fontSize: 9 }}>
                            <div style={{ fontWeight: 500, color: '#e0e0e0' }}>{tool.name}</div>
                            <div style={{ color: '#888', marginTop: 2 }}>{tool.description}</div>
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
