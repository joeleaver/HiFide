import { ScrollArea, Text, Stack, Group } from '@mantine/core'
import { useAppStore, useDispatch, selectSessions, selectCurrentId } from '../store'
import { useUiStore } from '../store/ui'
import { useEffect } from 'react'
import CollapsiblePanel from './CollapsiblePanel'

export default function TokensCostsPanel() {
  const dispatch = useDispatch()

  // Read persisted state from main store
  const persistedCollapsed = useAppStore((s) => s.windowState.tokensCostsCollapsed)
  const persistedHeight = useAppStore((s) => s.windowState.tokensCostsHeight)

  // Use UI store for local state
  const collapsed = useUiStore((s) => s.tokensCostsCollapsed)
  const height = useUiStore((s) => s.tokensCostsHeight)
  const setCollapsed = useUiStore((s) => s.setTokensCostsCollapsed)
  const setHeight = useUiStore((s) => s.setTokensCostsHeight)

  // Sync UI store with persisted state ONLY on mount
  // Don't sync during runtime to avoid race conditions
  useEffect(() => {
    setCollapsed(persistedCollapsed)
    setHeight(persistedHeight)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run on mount

  const sessions = useAppStore(selectSessions)
  const currentId = useAppStore(selectCurrentId)

  const currentSession = sessions.find((sess) => sess.id === currentId)

  const total = currentSession?.tokenUsage.total || { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }
  const byProvider = currentSession?.tokenUsage.byProvider || {}
  const byProviderAndModelTokens = (currentSession?.tokenUsage as any)?.byProviderAndModel || {}

  const costs = currentSession?.costs || { byProviderAndModel: {}, totalCost: 0, currency: 'USD' }
  const { totalCost, byProviderAndModel } = costs
  const hasUsage = total.totalTokens > 0

  return (
    <CollapsiblePanel
      title="TOKENS & COSTS"
      collapsed={collapsed}
      onToggleCollapse={() => {
        const newCollapsed = !collapsed
        setCollapsed(newCollapsed)
        dispatch('updateWindowState', { tokensCostsCollapsed: newCollapsed })
      }}
      height={height}
      onHeightChange={(newHeight) => {
        setHeight(newHeight)
        dispatch('updateWindowState', { tokensCostsHeight: newHeight })
      }}
      minHeight={150}
      maxHeight={400}
    >
      <ScrollArea style={{ height: '100%' }} type="auto">
        <div style={{ padding: '12px' }}>
          <Stack gap="md">
            {/* Session Totals */}
            <div>
              <Text size="xs" fw={600} c="blue" mb={4}>SESSION TOTALS</Text>
              <Group gap="xs" mb={2}>
                <Text size="xs" c="dimmed" style={{ minWidth: '60px' }}>Tokens:</Text>
                <Text size="xs">
                  <span style={{ color: '#4fc3f7' }}>{total.inputTokens.toLocaleString()}</span>
                  <span style={{ color: '#666' }}> in</span>
                  {total.cachedTokens && total.cachedTokens > 0 ? (
                    <>
                      <span style={{ color: '#666' }}> (</span>
                      <span style={{ color: '#ffa726' }}>💾 {total.cachedTokens.toLocaleString()} cached</span>
                      <span style={{ color: '#666' }}>)</span>
                    </>
                  ) : null}
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
                  <Text size="xs">
                    <span style={{ color: '#4ade80', fontWeight: 600 }}>${Number(totalCost ?? 0).toFixed(4)}</span>
                    {(() => {
                      // Calculate total savings across all providers/models
                      let totalSavings = 0
                      Object.entries(byProviderAndModel).forEach(([, models]) => {
                        Object.entries(models).forEach(([, cost]) => {
                          if (cost.savings) totalSavings += cost.savings
                        })
                      })
                      if (totalSavings > 0) {
                        const totalWithoutSavings = (totalCost || 0) + totalSavings
                        const savingsPercent = (totalSavings / totalWithoutSavings) * 100
                        return (
                          <span style={{ color: '#66bb6a', marginLeft: 8 }}>
                            (saved ${Number(totalSavings ?? 0).toFixed(4)} · {Math.round(savingsPercent || 0)}%)
                          </span>
                        )
                      }
                      return null
                    })()}
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
                        const perModelUsage = (byProviderAndModelTokens as any)?.[provider]?.[model]

                        return (
                          <div key={`${provider}-${model}`} style={{ marginBottom: '6px' }}>
                            <Text size="xs" c="#888" mb={2}>
                              {provider} / {model}
                            </Text>
                            <Group gap="xs" ml="md">
                              <Text size="xs" c="dimmed" style={{ minWidth: '50px' }}>Tokens:</Text>
                              <Text size="xs" c="dimmed">
                                {perModelUsage
                                  ? perModelUsage.totalTokens.toLocaleString()
                                  : providerUsage
                                  ? providerUsage.totalTokens.toLocaleString()
                                  : '—'}
                              </Text>
                            </Group>
                            <Group gap="xs" ml="md">
                              <Text size="xs" c="dimmed" style={{ minWidth: '50px' }}>Cost:</Text>
                              <Text size="xs" c="#4ade80">
                                ${Number(cost.totalCost ?? 0).toFixed(4)}
                              </Text>
                              <Text size="xs" c="dimmed">
                                (${Number(cost.inputCost ?? 0).toFixed(4)} in + ${Number(cost.outputCost ?? 0).toFixed(4)} out)
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

            {/* Requests Table */}
            {(() => {
              const logs: any[] = (currentSession as any)?.requestsLog || []
              if (!logs.length) return null
              // Oldest first; also de-duplicate by (requestId,nodeId,executionId)
              const asc = [...logs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
              const seen = new Set<string>()
              const rows = asc.filter((r) => {
                const k = `${r.requestId}:${r.nodeId}:${r.executionId}`
                if (seen.has(k)) return false
                seen.add(k)
                return true
              })
              return (
                <div>
                  <Text size="xs" fw={600} c="orange" mb={4}>REQUESTS (THIS SESSION)</Text>
                  <div style={{ overflowX: 'auto', fontSize: '12px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #333' }}>
                          <th style={{ textAlign: 'left', padding: '4px 8px' }}>Provider / Model</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px' }}>Input</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px' }}>Cost</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px' }}>Output</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px' }}>Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, idx) => {
                          const input = r?.usage?.inputTokens ?? 0
                          const output = r?.usage?.outputTokens ?? 0
                          const inputCost = r?.cost?.inputCost ?? 0
                          const outputCost = r?.cost?.outputCost ?? 0
                          return (
                            <tr key={`${r.requestId}:${r.nodeId}:${r.executionId}:${idx}`} style={{ borderBottom: '1px solid #222' }}>
                              <td style={{ padding: '4px 8px', color: '#888' }}>{r.provider} / {r.model}</td>
                              <td style={{ padding: '4px 8px', textAlign: 'right', color: '#4fc3f7' }}>{Number(input).toLocaleString()}</td>
                              <td style={{ padding: '4px 8px', textAlign: 'right', color: '#4ade80' }}>${Number(inputCost).toFixed(4)}</td>
                              <td style={{ padding: '4px 8px', textAlign: 'right', color: '#81c784' }}>{Number(output).toLocaleString()}</td>
                              <td style={{ padding: '4px 8px', textAlign: 'right', color: '#4ade80' }}>${Number(outputCost).toFixed(4)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })()}
          </Stack>
        </div>
      </ScrollArea>
    </CollapsiblePanel>
  )
}

