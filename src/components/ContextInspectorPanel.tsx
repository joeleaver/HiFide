import { ScrollArea, Text, Tabs } from '@mantine/core'
import { useUiStore } from '../store/ui'
import CollapsiblePanel from './CollapsiblePanel'
import JsonView from '@uiw/react-json-view'
import { darkTheme } from '@uiw/react-json-view/dark'
import { useFlowContexts } from '../store/flowContexts'
import { getBackendClient } from '../lib/backend/bootstrap'
import { useEffect } from 'react'

// Context colors (matching connection-colors.ts)
const CONTEXT_COLORS = {
  main: '#9b59b6',      // Purple - for main context
  isolated: '#14b8a6',  // Teal - for isolated context
}

export default function ContextInspectorPanel() {
  // Use UI store for local state
  const collapsed = useUiStore((s) => s.contextInspectorCollapsed)
  const height = useUiStore((s) => s.contextInspectorHeight)
  const setCollapsed = useUiStore((s) => s.setContextInspectorCollapsed)
  const setHeight = useUiStore((s) => s.setContextInspectorHeight)

  // Context state comes from store (backend events wired in bootstrap)
  const mainContext = useFlowContexts((s: any) => s.mainContext)
  const isolatedContexts = useFlowContexts((s: any) => s.isolatedContexts)

  // Hydrate persisted UI state on mount (renderer-only)
  // Keep this one effect for per-window UI persistence; it doesn't mirror backend data
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const client = getBackendClient(); if (!client) return
    client.rpc('ui.getWindowState', {}).then((res: any) => {
      const ws = (res && res.windowState) || {}
      setCollapsed(ws.contextInspectorCollapsed ?? false)
      setHeight(ws.contextInspectorHeight ?? 240)
    }).catch(() => {})
  }, [])

  const hasIsolatedContexts = Object.keys(isolatedContexts).length > 0

  return (
    <CollapsiblePanel
      title="CONTEXT INSPECTOR"
      collapsed={collapsed}
      onToggleCollapse={() => {
        const newCollapsed = !collapsed
        setCollapsed(newCollapsed)
        const client = getBackendClient(); if (client) client.rpc('ui.updateWindowState', { updates: { contextInspectorCollapsed: newCollapsed } }).catch(() => {})
      }}
      height={height}
      onHeightChange={(newHeight) => {
        setHeight(newHeight)
        const client = getBackendClient(); if (client) client.rpc('ui.updateWindowState', { updates: { contextInspectorHeight: newHeight } }).catch(() => {})
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

