import { ScrollArea, Text, Tabs } from '@mantine/core'
import { useMemo } from 'react'
import { useUiStore } from '../store/ui'
import CollapsiblePanel from './CollapsiblePanel'
import JsonView from '@uiw/react-json-view'
import { darkTheme } from '@uiw/react-json-view/dark'
import { useFlowContexts } from '../store/flowContexts'

// Context colors (matching connection-colors.ts)
const CONTEXT_COLORS = {
  main: '#9b59b6',      // Purple - for main context
  isolated: '#14b8a6',  // Teal - for isolated context
}

export default function ContextInspectorPanel() {
  // UI state from store (persisted to workspace-scoped localStorage)
  const collapsed = useUiStore((s) => s.contextInspectorCollapsed)
  const height = useUiStore((s) => s.contextInspectorHeight)
  const setCollapsed = useUiStore((s) => s.setContextInspectorCollapsed)
  const setHeight = useUiStore((s) => s.setContextInspectorHeight)

  // Context state comes from store (backend events wired in bootstrap)
  const mainContext = useFlowContexts((s: any) => s.mainContext)
  const isolatedContexts = useFlowContexts((s: any) => s.isolatedContexts)
  const requestId = useFlowContexts((s: any) => s.requestId)
  const updatedAt = useFlowContexts((s: any) => s.updatedAt)
  const truncatedRequestId = useMemo(() => {
    if (!requestId) return null
    // Prefix with first 8 chars for readability; append ellipsis if longer
    return requestId.length > 8 ? `${requestId.slice(0, 8)}…` : requestId
  }, [requestId])

  const updatedLabel = useMemo(() => {
    if (!updatedAt) return null
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(updatedAt))
  }, [updatedAt])


  const hasIsolatedContexts = Object.keys(isolatedContexts).length > 0

  return (
    <CollapsiblePanel
      title="CONTEXT INSPECTOR"
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed(!collapsed)}
      height={height}
      onHeightChange={setHeight}
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
        <>
          <div style={{
            padding: '6px 12px',
            borderBottom: '1px solid #2c2c2c',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}>
            <Text size="xs" c="dimmed">
              {truncatedRequestId ? (
                <>Active run: <span style={{ fontFamily: 'var(--font-mono)', color: '#e5e5e5' }}>{truncatedRequestId}</span></>
              ) : 'Idle'}
            </Text>
            {updatedLabel && (
              <Text size="xs" c="dimmed">Updated {updatedLabel}</Text>
            )}
          </div>

          <Tabs defaultValue="main" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Tabs.List style={{ borderBottom: '1px solid #2c2c2c', paddingLeft: 8 }}>
              <Tabs.Tab
                value="main"
                style={{
                  fontSize: 10,
                  padding: '6px 12px',
                  color: CONTEXT_COLORS.main,
                }}
              >
                Main Context
              </Tabs.Tab>
              {hasIsolatedContexts && Object.entries(isolatedContexts).map(([contextId]) => (
                <Tabs.Tab
                  key={contextId}
                  value={contextId}
                  style={{
                    fontSize: 10,
                    padding: '6px 12px',
                    color: CONTEXT_COLORS.isolated,
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
        </>
      )}
    </CollapsiblePanel>
  )
}

