import { ScrollArea, Text, Stack, Group } from '@mantine/core'
import { useEffect } from 'react'
import { getBackendClient } from '../lib/backend/bootstrap'
import { useUiStore } from '../store/ui'
import CollapsiblePanel from './CollapsiblePanel'
import { useSessionUi } from '../store/sessionUi'

// Minimal local types to avoid zubridge imports
type TokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number; cachedTokens?: number }

export default function TokensCostsPanel() {
  // Use UI store for local state
  const collapsed = useUiStore((s) => s.tokensCostsCollapsed)
  const height = useUiStore((s) => s.tokensCostsHeight)
  const setCollapsed = useUiStore((s) => s.setTokensCostsCollapsed)
  const setHeight = useUiStore((s) => s.setTokensCostsHeight)

  // Read usage/costs/logs from centralized session store
  const tokenUsage = useSessionUi((s: any) => s.tokenUsage) as {
    total: TokenUsage
    byProvider: Record<string, TokenUsage>
    byProviderAndModel: Record<string, Record<string, TokenUsage>>
  } | null
  const costs = useSessionUi((s: any) => s.costs) as any
  const requestsLog = useSessionUi((s: any) => s.requestsLog) as any[]

  // Hydrate UI-only sizing from backend window state; usage comes from sessionUi store
  useEffect(() => {
    const client = getBackendClient()
    if (!client) return
    ;(async () => {
      try {
        const ws = await client.rpc('ui.getWindowState', {})
        const windowState = ws?.windowState || {}
        if (typeof windowState.tokensCostsCollapsed === 'boolean') setCollapsed(windowState.tokensCostsCollapsed)
        if (typeof windowState.tokensCostsHeight === 'number') setHeight(windowState.tokensCostsHeight)
      } catch {}
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const total = tokenUsage?.total || { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }
  const byProvider = tokenUsage?.byProvider ?? ({} as Record<string, TokenUsage>)
  const byProviderAndModelTokens: Record<string, Record<string, TokenUsage>> = tokenUsage?.byProviderAndModel ?? {}
  const totalCost = Number(costs?.totalCost ?? 0)
  const byProviderAndModel = (costs?.byProviderAndModel ?? {}) as Record<string, Record<string, any>>
  const hasUsage = (total.totalTokens > 0) || ((total.cachedTokens || 0) > 0)

  return (
    <CollapsiblePanel
      title="TOKENS & COSTS"
      collapsed={collapsed}
      onToggleCollapse={() => {
        const newCollapsed = !collapsed
        setCollapsed(newCollapsed)
        const client = getBackendClient()
        try { void client?.rpc('ui.updateWindowState', { updates: { tokensCostsCollapsed: newCollapsed } }) } catch {}
      }}
      height={height}
      onHeightChange={(newHeight) => {
        setHeight(newHeight)
        const client = getBackendClient()
        try { void client?.rpc('ui.updateWindowState', { updates: { tokensCostsHeight: newHeight } }) } catch {}
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
                  <span style={{ color: '#fff' }}>{(total.inputTokens + total.outputTokens).toLocaleString()}</span>
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
                        const perModelUsage = byProviderAndModelTokens?.[provider]?.[model]

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
                            {(((perModelUsage?.cachedTokens || 0) > 0) || (cost as any)?.cachedInputCost) ? (
                              <Group gap="xs" ml="md">
                                <Text size="xs" c="dimmed" style={{ minWidth: '50px' }}>Cached:</Text>
                                <Text size="xs" c="#968c7fff">{(perModelUsage?.cachedTokens || 0).toLocaleString()}</Text>
                                <Text size="xs" c="#4ade80">${Number((cost as any)?.cachedInputCost || 0).toFixed(4)}</Text>
                              </Group>
                            ) : null}
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
              const logs: any[] = Array.isArray(requestsLog) ? requestsLog : []
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
                              <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                                {Number(r?.usage?.cachedTokens || 0) > 0 ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.1 }}>
                                    <span style={{ color: '#4fc3f7' }}>{Number(input).toLocaleString()}</span>
                                    <span style={{ color: '#968c7fff' }}>{Number(r?.usage?.cachedTokens || 0).toLocaleString()}</span>
                                  </div>
                                ) : (
                                  <span style={{ color: '#4fc3f7' }}>{Number(input).toLocaleString()}</span>
                                )}
                              </td>
                              <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                                {Number(r?.usage?.cachedTokens || 0) > 0 || Number((r?.cost?.cachedInputCost || 0)) > 0 ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.1 }}>
                                    <span style={{ color: '#4ade80' }}>${Number(Math.max(0, (inputCost - (r?.cost?.cachedInputCost || 0)))).toFixed(4)}</span>
                                    <span style={{ color: '#968c7fff' }}>${Number(r?.cost?.cachedInputCost || 0).toFixed(4)}</span>
                                  </div>
                                ) : (
                                  <span style={{ color: '#4ade80' }}>${Number(inputCost).toFixed(4)}</span>
                                )}
                              </td>
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

