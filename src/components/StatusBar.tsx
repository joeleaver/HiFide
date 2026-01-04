import { useEffect, useState } from 'react'
import { Group, Text, UnstyledButton, Loader, Tooltip } from '@mantine/core'
import { IconFolder, IconDatabase } from '@tabler/icons-react'
import { getBackendClient } from '../lib/backend/bootstrap'
import { useFlowEditorLocal } from '../store/flowEditorLocal'
import { useUiStore } from '../store/ui'
import { useWorkspaceUi } from '../store/workspaceUi'

const STATUS_BAR_HEIGHT = 24

export default function StatusBar() {
  // Read current view and workspace from centralized stores
  const currentView = useUiStore((s) => s.currentView)
  const workspaceRoot = useWorkspaceUi((s: any) => s.root)
  // TODO: Consider moving agentMetrics to a store; keep local UI-only hydration for now
  let agentMetrics: any | null = null

  // Flow counts (for flow view)
  const nodesCount = useFlowEditorLocal((s) => (s.nodes?.length ?? 0))
  const edgesCount = useFlowEditorLocal((s) => (s.edges?.length ?? 0))

  // Optional: hydrate agent metrics once (UI-only); workspace/view come from stores
  useEffect(() => {
    const client = getBackendClient()
    if (!client) return
    ;(async () => {
      try {
        const met = await client.rpc('session.getMetrics', {})
        if (met?.ok) agentMetrics = met.metrics || null
      } catch {}
    })()
  }, [])


  const [status, setStatus] = useState<any>(null)

  useEffect(() => {
    const client = getBackendClient()
    if (!client) return
    let unsubscribe: any = null
    ;(async () => {
      try {
        const res: any = await client.rpc('vector.getState', {})
        if (res?.ok) setStatus(res.state?.status)
        
        unsubscribe = client.subscribe('vector_service.changed', (state: any) => {
          setStatus(state?.status)
        })
      } catch (e) {}
    })()
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])

  // Perf: trace rerenders without passing large objects



  const handleFolderClick = async () => {
    const client = getBackendClient()
    if (!client) return
    try {
      const result: any = await client.rpc('workspace.openFolderDialog', {})
      if (result?.ok && result.path) {
        await client.rpc('workspace.open', { root: result.path })
        // Workspace root will update on workspace.attached notification
      }
    } catch (e) {
      // Silently ignore errors
    }
  }

  return (
    <Group
      gap={0}
      style={{
        height: STATUS_BAR_HEIGHT,
        backgroundColor: '#007acc',
        color: '#ffffff',
        fontSize: '12px',
        padding: '0 8px',
        borderTop: '1px solid #005a9e',
        flexShrink: 0,
        width: '100%',
      }}
      justify="space-between"
    >
      {/* Left side - Folder */}
      <Group gap={8}>
        <UnstyledButton
          onClick={handleFolderClick}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '0 8px',
            height: STATUS_BAR_HEIGHT,
            color: '#ffffff',
            cursor: 'pointer',
            transition: 'background-color 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <IconFolder size={14} stroke={2} />
          <Text size="xs" style={{ fontWeight: 500 }}>
            {workspaceRoot ? (workspaceRoot.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || workspaceRoot) : 'No Folder Open'}
          </Text>
        </UnstyledButton>
      </Group>

      {/* Right side - Combined status for agent view */}
      <Group gap={8} style={{ paddingRight: 8 }}>
        {status?.indexing && (
          <Tooltip label={`Indexing Vector DB: ${status.indexedFiles}/${status.totalFiles} files (${status.progress}%)`}>
            <Group gap={4} px={4} style={{ cursor: 'help' }}>
              <Loader size={10} color="white" />
              <IconDatabase size={14} />
              <Text size="xs" style={{ color: '#fff' }}>{status.progress}%</Text>
            </Group>
          </Tooltip>
        )}

        <Group gap={4} px={4}>
          <Tooltip label="Code Vectors">
            <Group gap={2} style={{ cursor: 'default' }}>
              <IconDatabase size={12} color="#60a5fa" />
              <Text size="xs" fw={500}>{status?.tables?.code?.count || 0}</Text>
            </Group>
          </Tooltip>
          <Tooltip label="Knowledge Base Vectors">
            <Group gap={2} style={{ cursor: 'default' }}>
              <IconDatabase size={12} color="#4ade80" />
              <Text size="xs" fw={500}>{status?.tables?.kb?.count || 0}</Text>
            </Group>
          </Tooltip>
          <Tooltip label="Memory Vectors">
            <Group gap={2} style={{ cursor: 'default' }}>
              <IconDatabase size={12} color="#fb923c" />
              <Text size="xs" fw={500}>{status?.tables?.memories?.count || 0}</Text>
            </Group>
          </Tooltip>
        </Group>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 8px', height: STATUS_BAR_HEIGHT }}>
          {currentView === 'flow' ? (
            // Agent view: Show flow stats + metrics
            <>
              {/* Flow stats */}
              <Text size="xs" style={{ color: '#fff', opacity: 0.9 }}>
                {nodesCount} nodes · {edgesCount} edges
              </Text>

              {/* Agent metrics */}
              {agentMetrics && (
                <>
                  <Text size="xs" c="dimmed" style={{ margin: '0 4px' }}>|</Text>
                  <Text size="xs" style={{ color: '#fff', opacity: 0.9 }}>
                    {`Tokens ${agentMetrics.tokensUsed}/${agentMetrics.tokenBudget} (${agentMetrics.percentageUsed}%) · Iters ${agentMetrics.iterationsUsed}/${agentMetrics.maxIterations}`}
                  </Text>
                </>
              )}

            </>
          ) : (
            // Other views: Show provider/model selectors only
            <>
              {/* Agent metrics compact display */}
              {agentMetrics && (
                <Text size="xs" style={{ color: '#fff', opacity: 0.9 }}>
                  {`Tokens ${agentMetrics.tokensUsed}/${agentMetrics.tokenBudget} (${agentMetrics.percentageUsed}%) · Iters ${agentMetrics.iterationsUsed}/${agentMetrics.maxIterations}`}
                </Text>
              )}
            </>
          )}
        </div>
      </Group>
    </Group>
  )
}

