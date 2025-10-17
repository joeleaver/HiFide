import { ScrollArea, Text, Stack, Group } from '@mantine/core'
import { useAppStore, useDispatch, selectSessions, selectCurrentId, selectLastRequestTokenUsage } from '../store'
import { useState } from 'react'
import CollapsiblePanel from './CollapsiblePanel'

export default function TokensCostsPanel() {
  const dispatch = useDispatch()

  // Read from windowState
  const initialCollapsed = useAppStore((s) => s.windowState.tokensCostsCollapsed)
  const initialHeight = useAppStore((s) => s.windowState.tokensCostsHeight)

  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [height, setHeight] = useState(initialHeight)

  const sessions = useAppStore(selectSessions)
  const currentId = useAppStore(selectCurrentId)
  const lastRequest = useAppStore(selectLastRequestTokenUsage)

  const currentSession = sessions.find((sess) => sess.id === currentId)

  const total = currentSession?.tokenUsage.total || { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }
  const byProvider = currentSession?.tokenUsage.byProvider || {}
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
                  {total.cachedTokens && total.cachedTokens > 0 && (
                    <>
                      <span style={{ color: '#666' }}> (</span>
                      <span style={{ color: '#ffa726' }}>💾 {total.cachedTokens.toLocaleString()} cached</span>
                      <span style={{ color: '#666' }}>)</span>
                    </>
                  )}
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
                    <span style={{ color: '#4ade80', fontWeight: 600 }}>${totalCost.toFixed(4)}</span>
                    {(() => {
                      // Calculate total savings across all providers/models
                      let totalSavings = 0
                      Object.entries(byProviderAndModel).forEach(([, models]) => {
                        Object.entries(models).forEach(([, cost]) => {
                          if (cost.savings) totalSavings += cost.savings
                        })
                      })
                      if (totalSavings > 0) {
                        const totalWithoutSavings = totalCost + totalSavings
                        const savingsPercent = (totalSavings / totalWithoutSavings) * 100
                        return (
                          <span style={{ color: '#66bb6a', marginLeft: 8 }}>
                            (saved ${totalSavings.toFixed(4)} · {savingsPercent.toFixed(0)}%)
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

              const cost = lr.cost

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
                      {lr.usage.cachedTokens && lr.usage.cachedTokens > 0 && (
                        <>
                          <span style={{ color: '#666' }}> (</span>
                          <span style={{ color: '#ffa726' }}>💾 {lr.usage.cachedTokens.toLocaleString()} cached</span>
                          <span style={{ color: '#666' }}>)</span>
                        </>
                      )}
                      <span style={{ color: '#666' }}> + </span>
                      <span style={{ color: '#81c784' }}>{lr.usage.outputTokens.toLocaleString()}</span>
                      <span style={{ color: '#666' }}> out</span>
                      <span style={{ color: '#666' }}> = </span>
                      <span style={{ color: '#ccc' }}>{lr.usage.totalTokens.toLocaleString()}</span>
                    </Text>
                  </Group>
                  <Group gap="xs" ml="md">
                    <Text size="xs" c="dimmed" style={{ minWidth: '50px' }}>Cost:</Text>
                    {cost ? (
                      <Text size="xs">
                        <span style={{ color: '#4ade80' }}>${cost.totalCost.toFixed(4)}</span>
                        {cost.savings && cost.savings > 0 && (
                          <span style={{ color: '#66bb6a', marginLeft: 8 }}>
                            (saved ${cost.savings.toFixed(4)} · {cost.savingsPercent?.toFixed(0)}%)
                          </span>
                        )}
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
        </div>
      </ScrollArea>
    </CollapsiblePanel>
  )
}

