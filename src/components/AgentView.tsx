import { Group, Stack, Text, UnstyledButton, ScrollArea, Card, Select, Button, Badge } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconPlus } from '@tabler/icons-react'
import { useAppStore, selectSessions, selectCurrentId, selectWorkspaceRoot, selectMetaPanelOpen, selectDebugPanelCollapsed, selectCtxRefreshing, selectCtxResult, selectLastRequestTokenUsage, selectLastRequestSavings } from '../store'
import { usePanelResize } from '../hooks/usePanelResize'
import ChatPane from '../ChatPane'
import TerminalPanel from './TerminalPanel'
import AgentDebugPanel from './AgentDebugPanel'
import FlowCanvasPanel from './FlowCanvasPanel'



export default function AgentView() {
  // Use selectors for better performance
  const metaPanelOpen = useAppStore(selectMetaPanelOpen)
  const debugPanelCollapsed = useAppStore(selectDebugPanelCollapsed)
  const debugPanelHeight = useAppStore((s) => s.debugPanelHeight)
  const setDebugPanelHeight = useAppStore((s) => s.setDebugPanelHeight)
  const sessions = useAppStore(selectSessions)
  const currentId = useAppStore(selectCurrentId)
  const workspaceRoot = useAppStore(selectWorkspaceRoot)

  // Flow canvas state
  const flowCanvasCollapsed = useAppStore((s) => s.flowCanvasCollapsed)
  const setFlowCanvasCollapsed = useAppStore((s) => s.setFlowCanvasCollapsed)
  const flowCanvasWidth = useAppStore((s) => s.flowCanvasWidth)
  const setFlowCanvasWidth = useAppStore((s) => s.setFlowCanvasWidth)

  // Context state - use selectors
  const ctxRefreshing = useAppStore(selectCtxRefreshing)
  const ctxResult = useAppStore(selectCtxResult)
  const lastRequest = useAppStore(selectLastRequestTokenUsage)
  const lastSavings = useAppStore(selectLastRequestSavings)

  // Actions only - these don't cause re-renders
  const setMetaPanelOpen = useAppStore((s) => s.setMetaPanelOpen)
  const select = useAppStore((s) => s.select)
  const refreshContext = useAppStore((s) => s.refreshContext)
  const newSession = useAppStore((s) => s.newSession)
  const calculateCost = useAppStore((s) => s.calculateCost)

  // Debug panel resize handler
  const { onMouseDown, isResizingRef } = usePanelResize({
    getHeight: () => debugPanelHeight,
    setHeight: setDebugPanelHeight,
    min: 150,
    max: 600,
  })

  return (
    <Group
      gap={0}
      style={{
        flex: 1,
        height: '100%',
        overflow: 'hidden',
      }}
      align="stretch"
    >
      {/* Main Chat Area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          backgroundColor: '#1e1e1e',
          overflow: 'hidden',
        }}
      >
        {/* Session Selector Bar */}
        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid #3e3e42',
            backgroundColor: '#252526',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Select
            value={currentId || undefined}
            onChange={(v) => v && select(v)}
            data={sessions.map((sess) => ({
              value: sess.id,
              label: sess.title || 'Untitled',
            }))}
            placeholder="Select session"
            size="xs"
            style={{ flex: 1, maxWidth: 300 }}
            styles={{
              input: {
                backgroundColor: '#1e1e1e',
                border: '1px solid #3e3e42',
                color: '#cccccc',
              },
            }}
          />
          <Button
            size="xs"
            variant="light"
            leftSection={<IconPlus size={14} />}
            onClick={() => newSession()}
          >
            New
          </Button>
        </div>

        {/* Chat + Terminal Panel (bottom) */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <ChatPane />
          </div>
          {/* Bottom panel (agent context) */}
          <div style={{ borderTop: '1px solid #3e3e42' }}>
            <TerminalPanel context="agent" />
          </div>
        </div>
      </div>

      {/* Flow Canvas Panel */}
      <FlowCanvasPanel
        collapsed={flowCanvasCollapsed}
        onToggleCollapse={() => setFlowCanvasCollapsed(!flowCanvasCollapsed)}
        width={flowCanvasWidth}
        onResize={setFlowCanvasWidth}
      />

      {/* Meta Panel */}
      {metaPanelOpen && (
        <div
          style={{
            width: 300,
            height: '100%',
            backgroundColor: '#252526',
            borderLeft: '1px solid #3e3e42',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Meta Panel Header */}
          <Group
            justify="space-between"
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid #3e3e42',
              backgroundColor: '#2d2d30',
            }}
          >
            <Text size="sm" fw={600}>
              Agent Info
            </Text>
            <UnstyledButton
              onClick={() => setMetaPanelOpen(false)}
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

          {/* Meta Panel Content - Scrollable */}
          <ScrollArea style={{ flex: 1 }} p="md">
            <Stack gap="md">
              <Card withBorder style={{ backgroundColor: '#1e1e1e' }}>
                <Stack gap="xs">
                  <Text size="xs" fw={600} c="dimmed">CONTEXT</Text>
                  <Group justify="space-between">
                    <Button size="xs" variant="light" onClick={refreshContext} loading={ctxRefreshing} disabled={!workspaceRoot}>
                      Refresh Context
                    </Button>
                    {ctxResult ? (
                      ctxResult.ok ? (
                        <Badge color="teal" variant="light" size="xs">OK</Badge>
                      ) : (
                        <Badge color="red" variant="light" size="xs">ERROR</Badge>
                      )
                    ) : null}
                  </Group>
                  <Stack gap={2}>
                    <Text size="xs" c="dimmed">Folder: {workspaceRoot || '—'}</Text>
                    {ctxResult?.ok ? (
                      <Text size="xs" c="dimmed">
                        {ctxResult.createdPublic ? 'Created .hifide-public; ' : ''}
                        {ctxResult.createdPrivate ? 'Created .hifide-private; ' : ''}
                        {ctxResult.ensuredGitIgnore ? 'Updated .gitignore; ' : ''}
                        {ctxResult.generatedContext ? 'Generated context' : 'Context already present'}
                      </Text>
                    ) : ctxResult?.error ? (
                      <Text size="xs" c="red.4">{ctxResult.error}</Text>
                    ) : (
                      <Text size="xs" c="dimmed">No recent action</Text>
                    )}
                  </Stack>
                </Stack>
              </Card>

              <Card withBorder style={{ backgroundColor: '#1e1e1e' }}>
                <Stack gap="md">
                  <Text size="xs" fw={600} c="dimmed">
                    TOKEN USAGE & COSTS
                  </Text>

                  {/* Session Total */}
                  {(() => {
                    const currentSession = sessions.find((sess) => sess.id === currentId)
                    if (!currentSession) return <Text size="sm" c="dimmed">No session selected</Text>

                    const { total, byProvider } = currentSession.tokenUsage
                    const costs = currentSession.costs || { byProviderAndModel: {}, totalCost: 0, currency: 'USD' }
                    const { totalCost, byProviderAndModel } = costs
                    const hasUsage = total.totalTokens > 0

                    return (
                      <Stack gap="md">
                        {/* Session Totals */}
                        <div>
                          <Text size="xs" fw={600} c="blue" mb={4}>SESSION TOTALS</Text>
                          <Group gap="xs" mb={2}>
                            <Text size="xs" c="dimmed" style={{ minWidth: '60px' }}>Tokens:</Text>
                            <Text size="xs">
                              <span style={{ color: '#4fc3f7' }}>{total.inputTokens.toLocaleString()}</span>
                              <span style={{ color: '#666' }}> in</span>
                              <span style={{ color: '#666' }}> + </span>
                              <span style={{ color: '#81c784' }}>{total.outputTokens.toLocaleString()}</span>
                              <span style={{ color: '#666' }}> out</span>
                              <span style={{ color: '#666' }}> = </span>
                              <span style={{ color: '#fff' }}>{total.totalTokens.toLocaleString()}</span>
                            </Text>
                          </Group>
                          {totalCost > 0 && (
                            <Group gap="xs">
                              <Text size="xs" c="dimmed" style={{ minWidth: '60px' }}>Cost:</Text>
                              <Text size="xs" c="#4ade80" fw={600}>
                                ${totalCost.toFixed(4)} USD
                              </Text>
                            </Group>
                          )}
                        </div>

                        {/* By Provider & Model */}
                        {hasUsage && Object.keys(byProviderAndModel).length > 0 && (
                          <div>
                            <Text size="xs" fw={600} c="dimmed" mb={4}>BY PROVIDER & MODEL</Text>
                            <Stack gap={6}>
                              {Object.entries(byProviderAndModel).map(([provider, models]) => (
                                <div key={provider}>
                                  {Object.entries(models).map(([model, cost]) => {
                                    // Get token usage for this provider/model combination
                                    const providerUsage = byProvider[provider]

                                    return (
                                      <div key={`${provider}-${model}`} style={{ marginBottom: '6px' }}>
                                        <Text size="xs" c="#888" mb={2}>
                                          {provider} / {model}
                                        </Text>
                                        <Group gap="xs" ml="md">
                                          <Text size="xs" c="dimmed" style={{ minWidth: '50px' }}>Tokens:</Text>
                                          <Text size="xs" c="dimmed">
                                            {providerUsage ? providerUsage.totalTokens.toLocaleString() : '—'}
                                          </Text>
                                        </Group>
                                        <Group gap="xs" ml="md">
                                          <Text size="xs" c="dimmed" style={{ minWidth: '50px' }}>Cost:</Text>
                                          <Text size="xs" c="#4ade80">
                                            ${cost.totalCost.toFixed(4)}
                                          </Text>
                                          <Text size="xs" c="dimmed">
                                            (${cost.inputCost.toFixed(4)} in + ${cost.outputCost.toFixed(4)} out)
                                          </Text>
                                        </Group>
                                      </div>
                                    )
                                  })}
                                </div>
                              ))}
                            </Stack>
                          </div>
                        )}

                        {/* Last Request */}
                        {(() => {
                          const lr = lastRequest
                          if (!lr) return null

                          const cost = calculateCost(
                            lr.provider,
                            lr.model,
                            lr.usage
                          )

                          return (
                            <div>
                              <Text size="xs" fw={600} c="orange" mb={4}>LAST REQUEST</Text>
                              <Text size="xs" c="#888" mb={2}>
                                {lr.provider} / {lr.model}
                              </Text>
                              <Group gap="xs" ml="md">
                                <Text size="xs" c="dimmed" style={{ minWidth: '50px' }}>Tokens:</Text>
                                <Text size="xs">
                                  <span style={{ color: '#4fc3f7' }}>{lr.usage.inputTokens.toLocaleString()}</span>
                                  <span style={{ color: '#666' }}> in</span>
                                  <span style={{ color: '#666' }}> + </span>
                                  <span style={{ color: '#81c784' }}>{lr.usage.outputTokens.toLocaleString()}</span>
                                  <span style={{ color: '#666' }}> out</span>
                                  <span style={{ color: '#666' }}> = </span>
                                  <span style={{ color: '#ccc' }}>{lr.usage.totalTokens.toLocaleString()}</span>
                                  {lastSavings && lastSavings.provider === lr.provider && lastSavings.model === lr.model && (
                                    <span style={{ color: '#66bb6a', marginLeft: 8 }}>−{lastSavings.approxTokensAvoided.toLocaleString()} saved</span>
                                  )}
                                </Text>
                              </Group>
                              <Group gap="xs" ml="md">
                                <Text size="xs" c="dimmed" style={{ minWidth: '50px' }}>Cost:</Text>
                                {cost ? (
                                  <Text size="xs" c="#4ade80">
                                    ${cost.totalCost.toFixed(4)} USD
                                  </Text>
                                ) : (
                                  <Text size="xs" c="dimmed" fs="italic">
                                    Unknown (no pricing configured)
                                  </Text>
                                )}
                              </Group>
                            </div>
                          )
                        })()}
                      </Stack>
                    )
                  })()}
                </Stack>
              </Card>
            </Stack>
          </ScrollArea>

          {/* Agent Debug Panel - Fixed at bottom with resize handle */}
          <div style={{
            borderTop: '1px solid #3e3e42',
            height: debugPanelCollapsed ? 'auto' : `${debugPanelHeight}px`,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
          }}>
            {/* Resize handle - only show when not collapsed */}
            {!debugPanelCollapsed && (
              <div
                onMouseDown={onMouseDown}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: '4px',
                  cursor: 'ns-resize',
                  backgroundColor: 'transparent',
                  zIndex: 10,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#007acc'
                }}
                onMouseLeave={(e) => {
                  if (!isResizingRef.current) {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }
                }}
              />
            )}
            <div style={{ flex: debugPanelCollapsed ? 'none' : 1, overflow: 'hidden' }}>
              <AgentDebugPanel />
            </div>
          </div>
        </div>
      )}

      {/* Toggle button when panel is closed */}
      {!metaPanelOpen && (
        <UnstyledButton
          onClick={() => setMetaPanelOpen(true)}
          style={{
            width: 24,
            height: '100%',
            backgroundColor: '#252526',
            borderLeft: '1px solid #3e3e42',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#cccccc',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#2d2d30'
            e.currentTarget.style.color = '#ffffff'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#252526'
            e.currentTarget.style.color = '#cccccc'
          }}
        >
          <IconChevronLeft size={16} />
        </UnstyledButton>
      )}
    </Group>
  )
}

