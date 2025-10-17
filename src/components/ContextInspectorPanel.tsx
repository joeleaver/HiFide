import { ScrollArea, Text } from '@mantine/core'
import { useAppStore, useDispatch } from '../store'
import { useState } from 'react'
import CollapsiblePanel from './CollapsiblePanel'
import JsonView from '@uiw/react-json-view'
import { darkTheme } from '@uiw/react-json-view/dark'

export default function ContextInspectorPanel() {
  const dispatch = useDispatch()

  // Read from windowState
  const initialCollapsed = useAppStore((s) => s.windowState.contextInspectorCollapsed)
  const initialHeight = useAppStore((s) => s.windowState.contextInspectorHeight)

  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [height, setHeight] = useState(initialHeight)

  // Get main flow context from flow editor state (ephemeral, only exists during flow execution)
  const mainFlowContext = useAppStore((s) => s.feMainFlowContext)

  // Fall back to session.currentContext if no main flow context (flow not running)
  const currentId = useAppStore((s) => s.currentId)
  const sessions = useAppStore((s) => s.sessions)
  const currentSession = sessions.find((s: any) => s.id === currentId)

  const contextData = mainFlowContext || currentSession?.currentContext || null

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
      {!contextData ? (
        <div style={{ padding: '12px' }}>
          <Text size="xs" c="dimmed" style={{ fontStyle: 'italic' }}>
            No context available. Start a flow to see execution context.
          </Text>
        </div>
      ) : (
        <ScrollArea style={{ height: '100%' }} type="auto">
          <div style={{ padding: '8px' }}>
            <JsonView
              value={contextData}
              style={darkTheme}
              collapsed={false}
              displayDataTypes={false}
              displayObjectSize={true}
              enableClipboard={true}
            />
          </div>
        </ScrollArea>
      )}
    </CollapsiblePanel>
  )
}

