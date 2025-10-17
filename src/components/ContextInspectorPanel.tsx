import { ScrollArea, Text, Tabs } from '@mantine/core'
import { useAppStore, useDispatch } from '../store'
import { useState } from 'react'
import CollapsiblePanel from './CollapsiblePanel'
import JsonView from '@uiw/react-json-view'
import { darkTheme } from '@uiw/react-json-view/dark'

// Context colors (matching connection-colors.ts)
const CONTEXT_COLORS = {
  main: '#9b59b6',      // Purple - for main context
  isolated: '#14b8a6',  // Teal - for isolated context
}

export default function ContextInspectorPanel() {
  const dispatch = useDispatch()

  // Read from windowState
  const initialCollapsed = useAppStore((s) => s.windowState.contextInspectorCollapsed)
  const initialHeight = useAppStore((s) => s.windowState.contextInspectorHeight)

  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [height, setHeight] = useState(initialHeight)

  // Get main flow context from flow editor state (ephemeral, only exists during flow execution)
  const mainFlowContext = useAppStore((s) => s.feMainFlowContext)
  const isolatedContexts = useAppStore((s) => s.feIsolatedContexts)

  // Fall back to session.currentContext if no main flow context (flow not running)
  const currentId = useAppStore((s) => s.currentId)
  const sessions = useAppStore((s) => s.sessions)
  const currentSession = sessions.find((s: any) => s.id === currentId)

  const mainContext = mainFlowContext || currentSession?.currentContext || null
  const hasIsolatedContexts = Object.keys(isolatedContexts).length > 0

  return (
    <CollapsiblePanel
      title="CONTEXT INSPECTOR"
      collapsed={collapsed}
      onToggleCollapse={() => {
        const newCollapsed = !collapsed
        setCollapsed(newCollapsed)
        dispatch('updateWindowState', { contextInspectorCollapsed: newCollapsed })
      }}
      height={height}
      onHeightChange={(newHeight) => {
        setHeight(newHeight)
        dispatch('updateWindowState', { contextInspectorHeight: newHeight })
      }}
      minHeight={150}
      maxHeight={400}
    >
      {!mainContext && !hasIsolatedContexts ? (
        <div style={{ padding: '12px' }}>
          <Text size="xs" c="dimmed" style={{ fontStyle: 'italic' }}>
            No context available. Start a flow to see execution context.
          </Text>
        </div>
      ) : (
        <Tabs defaultValue="main" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Tabs.List style={{ borderBottom: '1px solid #2c2c2c', paddingLeft: 8 }}>
            <Tabs.Tab
              value="main"
              style={{
                fontSize: 10,
                padding: '6px 12px',
                color: CONTEXT_COLORS.main
              }}
            >
              Main Context
            </Tabs.Tab>
            {hasIsolatedContexts && Object.entries(isolatedContexts).map(([contextId, _context]) => (
              <Tabs.Tab
                key={contextId}
                value={contextId}
                style={{
                  fontSize: 10,
                  padding: '6px 12px',
                  color: CONTEXT_COLORS.isolated
                }}
              >
                {contextId.split('-').slice(0, 2).join('-')}...
              </Tabs.Tab>
            ))}
          </Tabs.List>

          <Tabs.Panel value="main" style={{ flex: 1, overflow: 'hidden' }}>
            {mainContext ? (
              <ScrollArea style={{ height: '100%' }} type="auto">
                <div style={{ padding: '8px' }}>
                  <JsonView
                    value={mainContext}
                    style={darkTheme}
                    collapsed={false}
                    displayDataTypes={false}
                    displayObjectSize={true}
                    enableClipboard={true}
                  />
                </div>
              </ScrollArea>
            ) : (
              <div style={{ padding: '12px' }}>
                <Text size="xs" c="dimmed" style={{ fontStyle: 'italic' }}>
                  No main context available.
                </Text>
              </div>
            )}
          </Tabs.Panel>

          {hasIsolatedContexts && Object.entries(isolatedContexts).map(([contextId, context]) => (
            <Tabs.Panel key={contextId} value={contextId} style={{ flex: 1, overflow: 'hidden' }}>
              <ScrollArea style={{ height: '100%' }} type="auto">
                <div style={{ padding: '8px' }}>
                  <JsonView
                    value={context as object}
                    style={darkTheme}
                    collapsed={false}
                    displayDataTypes={false}
                    displayObjectSize={true}
                    enableClipboard={true}
                  />
                </div>
              </ScrollArea>
            </Tabs.Panel>
          ))}
        </Tabs>
      )}
    </CollapsiblePanel>
  )
}

