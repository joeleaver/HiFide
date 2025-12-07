import { Badge, Card, Group, ScrollArea, SimpleGrid, Stack, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import CollapsiblePanel from './CollapsiblePanel'
import { useUiStore } from '../store/ui'
import { useSessionUi } from '../store/sessionUi'

// Minimal local types to avoid zubridge imports
type TokenUsage = {
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  totalTokens: number
  reasoningTokens?: number
}

type CostBreakdown = {
  inputCost: number
  cachedCost: number
  outputCost: number
  totalCost: number
  currency: string
}

const DEFAULT_USAGE: TokenUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0 }

const DEFAULT_COSTS: CostBreakdown = { inputCost: 0, cachedCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' }

const formatCurrency = (value: number, currency = 'USD') => {
  const amount = Number.isFinite(value) ? value : 0
  const prefix = currency === 'USD' ? '$' : ''
  return `${prefix}${amount.toFixed(4)}`
}

const formatTokens = (value?: number) => (Number.isFinite(value) ? Number(value).toLocaleString() : '0')

const formatTimestamp = (ts?: number) => {
  if (!ts) return null
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

type SummaryCardProps = {
  label: string
  value: string
  accent: string
  children?: ReactNode
}

const SummaryCard = ({ label, value, accent, children }: SummaryCardProps) => (
  <Card withBorder padding="sm" radius="md" style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
    <Text size="xs" c="dimmed" mb={4}>
      {label}
    </Text>
    <Text size="lg" fw={600} c={accent}>
      {value}
    </Text>
    {children && (
      typeof children === 'string' || typeof children === 'number' ? (
        <Text size="xs" c="dimmed" mt={4}>
          {children}
        </Text>
      ) : (
        <div style={{ marginTop: 6 }}>{children}</div>
      )
    )}
  </Card>
)

const LabelValueRow = ({ label, value, color = '#fff' }: { label: string; value: ReactNode; color?: string }) => {
  const isPrimitive = typeof value === 'string' || typeof value === 'number'
  return (
    <Group justify="space-between" align="flex-start" gap="xs">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      {isPrimitive ? (
        <Text size="xs" style={{ color, textAlign: 'right' }}>
          {value}
        </Text>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', textAlign: 'right', fontSize: 12 }}>
          {value}
        </div>
      )}
    </Group>
  )
}

const summaryGridResponsive = {
  breakpoints: [
    { maxWidth: '70em', cols: 2 },
    { maxWidth: '48em', cols: 1 },
  ],
}

const inputGridResponsive = {
  breakpoints: [{ maxWidth: '48em', cols: 1 }],
}

const requestMetricsGrid = {
  breakpoints: [
    { maxWidth: '62em', cols: 2 },
    { maxWidth: '40em', cols: 1 },
  ],
}

type MetricValueProps = {
  tokens: number
  cost: number
  currency: string
  tokensColor: string
  costColor: string
  tokenLabel?: string
  subtitle?: ReactNode
  align?: 'flex-start' | 'flex-end' | 'center' | 'stretch'
  showCost?: boolean
}

const MetricValue = ({
  tokens,
  cost,
  currency,
  tokensColor,
  costColor,
  tokenLabel = 'tokens',
  subtitle,
  align = 'flex-end',
  showCost = true,
}: MetricValueProps) => (
  <Stack gap={2} align={align} style={{ minWidth: 90 }}>
    <Text size="xs" style={{ color: tokensColor }}>
      {formatTokens(tokens)} {tokenLabel}
    </Text>
    {subtitle}
    {showCost && (
      <Text size="xs" style={{ color: costColor }}>
        {formatCurrency(cost, currency)}
      </Text>
    )}
  </Stack>
)

const RequestMetric = ({ label, align = 'flex-start', ...metricProps }: { label: string } & MetricValueProps) => (
  <Stack gap={2} style={{ minWidth: 110 }}>
    <Text size="xs" fw={600} c="dimmed">
      {label}
    </Text>
    <MetricValue align={align} {...metricProps} />
  </Stack>
)

export default function TokensCostsPanel() {
  // Panel chrome
  const collapsed = useUiStore((s) => s.tokensCostsCollapsed)
  const height = useUiStore((s) => s.tokensCostsHeight)
  const setCollapsed = useUiStore((s) => s.setTokensCostsCollapsed)
  const setHeight = useUiStore((s) => s.setTokensCostsHeight)

  // Session state (shared renderer store)
  const tokenUsage = useSessionUi((s: any) => s.tokenUsage) as {
    total: TokenUsage
    byProvider: Record<string, TokenUsage>
    byProviderAndModel: Record<string, Record<string, TokenUsage>>
  } | null
  const costs = (useSessionUi((s: any) => s.costs) as any) || DEFAULT_COSTS
  const totalUsage: TokenUsage = tokenUsage?.total ?? DEFAULT_USAGE
  const totalInputTokens = Number(totalUsage.inputTokens ?? 0)
  const totalCachedTokens = Number(totalUsage.cachedTokens ?? 0)
  const totalOutputTokens = Number(totalUsage.outputTokens ?? 0)
  const currency = typeof costs?.currency === 'string' ? costs.currency : 'USD';
  const inputCostTotal = Number(costs?.inputCost ?? 0);
  const cachedCostTotal = Number(costs?.cachedCost ?? 0);
  const outputCostTotal = Number(costs?.outputCost ?? 0);
  const totalCost = Number.isFinite(Number(costs?.totalCost))
    ? Number(costs?.totalCost)
    : inputCostTotal + cachedCostTotal + outputCostTotal
  const totalSavings = 0
  const cachedInputPercent = totalInputTokens + totalCachedTokens > 0
    ? (totalCachedTokens / (totalInputTokens + totalCachedTokens)) * 100
    : 0
  const cachedSavingsLabel = '—';
  const byProviderAndModelTokens = (tokenUsage?.byProviderAndModel ?? {}) as Record<string, Record<string, TokenUsage>>;
  const byProviderTokens = (tokenUsage?.byProvider ?? {}) as Record<string, TokenUsage>;
  const byProviderAndModelCosts = (costs?.byProviderAndModel ?? {}) as Record<string, Record<string, any>>;
  const hasUsage =
    totalInputTokens > 0 ||
    totalOutputTokens > 0 ||
    totalCachedTokens > 0 ||
    Object.keys(byProviderAndModelTokens).length > 0

  const requestsLog = (useSessionUi((s: any) => s.requestsLog) as any[]) || []

  const requestRows = (() => {
    if (!Array.isArray(requestsLog) || !requestsLog.length) return []
    const asc = [...requestsLog].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    const seen = new Set<string>()
    return asc.filter((entry) => {
      const key = `${entry.requestId}:${entry.nodeId}:${entry.executionId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })()

  const totalTokens = totalUsage.totalTokens || totalInputTokens + totalOutputTokens

  return (
    <CollapsiblePanel
      title="TOKENS & COSTS"
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed(!collapsed)}
      height={height}
      onHeightChange={setHeight}
      minHeight={150}
      maxHeight={400}
    >
      <ScrollArea style={{ height: '100%' }} type="auto">
        <Stack gap="lg" style={{ padding: 12 }}>
          <div>
            <Text size="xs" fw={600} c="blue" mb={6}>SESSION SNAPSHOT</Text>
            <SimpleGrid cols={3} spacing="sm" {...summaryGridResponsive}>
              <SummaryCard
                label="Total tokens"
                value={formatTokens(totalTokens)}
                accent="#4fc3f7"
              >
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">
                    Input ·{' '}
                    <Text span c="#4fc3f7" fw={500}>{formatTokens(totalInputTokens)}</Text>
                  </Text>
                  <Text size="xs" c="dimmed">
                    Cached input ·{' '}
                    <Text span c="#ffa726" fw={500}>{formatTokens(totalCachedTokens)}</Text>
                  </Text>
                  <Text size="xs" c="dimmed">
                    Output ·{' '}
                    <Text span c="#81c784" fw={500}>{formatTokens(totalOutputTokens)}</Text>
                  </Text>
                </Stack>
              </SummaryCard>
              <SummaryCard
                label="Total cost"
                value={formatCurrency(totalCost, currency)}
                accent="#4ade80"
              >
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">
                    Input ·{' '}
                    <Text span c="#4ade80" fw={500}>{formatCurrency(inputCostTotal + cachedCostTotal, currency)}</Text>
                  </Text>
                  <Text size="xs" c="dimmed">
                    Output ·{' '}
                    <Text span c="#81c784" fw={500}>{formatCurrency(outputCostTotal, currency)}</Text>
                  </Text>
                </Stack>
              </SummaryCard>
              <SummaryCard
                label="Cached input"
                value={formatTokens(totalCachedTokens)}
                accent="#ffa726"
              >
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">
                    Cost ·{' '}
                    <Text span c="#ffa726" fw={500}>{formatCurrency(cachedCostTotal, currency)}</Text>
                  </Text>
                  <Text size="xs" c="dimmed">
                    Savings ·{' '}
                    <Text span c="#66bb6a" fw={500}>{cachedSavingsLabel}</Text>
                  </Text>
                  <Text size="xs" c="dimmed">
                    Share of input ·{' '}
                    <Text span c="#ffa726" fw={500}>{Math.round(cachedInputPercent)}%</Text>
                  </Text>
                </Stack>
              </SummaryCard>
            </SimpleGrid>
          </div>

          {(totalInputTokens > 0 || totalCachedTokens > 0 || totalUsage.reasoningTokens || inputCostTotal > 0 || cachedCostTotal > 0 || totalSavings > 0) && (
            <Card withBorder padding="sm" radius="md">
              <Group justify="space-between" align="flex-start" mb="xs">
                <div>
                  <Text size="xs" fw={600} c="dimmed">INPUT LANES</Text>
                  <Text size="xs" c="dimmed">Input vs cached traffic</Text>
                </div>
                {totalUsage.reasoningTokens && totalUsage.reasoningTokens > 0 && (
                  <Badge size="xs" color="teal" variant="light">
                    {formatTokens(totalUsage.reasoningTokens)} thinking tokens
                  </Badge>
                )}
              </Group>
              <SimpleGrid cols={2} spacing="md" {...inputGridResponsive}>
                <Stack gap={4}>
                  <Text size="xs" fw={600}>Input</Text>
                  <LabelValueRow
                    label="Tokens"
                    value={`${formatTokens(totalInputTokens)} tokens`}
                    color="#4fc3f7"
                  />
                  <LabelValueRow
                    label="Cost"
                    value={formatCurrency(inputCostTotal, currency)}
                    color="#4ade80"
                  />
                </Stack>
                <Stack gap={4}>
                  <Text size="xs" fw={600}>Cached input</Text>
                  <LabelValueRow
                    label="Tokens"
                    value={`${formatTokens(totalCachedTokens)} tokens`}
                    color="#ffa726"
                  />
                  <LabelValueRow
                    label="Cost"
                    value={formatCurrency(cachedCostTotal, currency)}
                    color="#ffa726"
                  />
                  <LabelValueRow
                    label="Savings"
                    value={cachedSavingsLabel}
                    color="#66bb6a"
                  />
                </Stack>
              </SimpleGrid>
            </Card>
          )}

          {hasUsage && Object.keys(byProviderAndModelCosts).length > 0 && (
            <Stack gap="xs">
              <Text size="xs" fw={600} c="dimmed">BY PROVIDER & MODEL</Text>
              <Stack gap="sm">
                {Object.entries(byProviderAndModelCosts).map(([provider, models]) => (
                  <Card key={provider} withBorder padding="sm" radius="md">
                    <Group justify="space-between" align="center" mb="xs">
                      <Text size="sm" fw={600}>{provider}</Text>
                      <Badge size="xs" variant="light" color="gray">
                        {Object.keys(models).length} model{Object.keys(models).length === 1 ? '' : 's'}
                      </Badge>
                    </Group>
                    <Stack gap="xs">
                      {Object.entries(models).map(([model, cost]) => {
                        const usage = byProviderAndModelTokens?.[provider]?.[model] || byProviderTokens[provider]
                        const inputTokens = Number(usage?.inputTokens ?? 0)
                        const outputTokens = Number(usage?.outputTokens ?? 0)
                        const reasoningTokens = Number(usage?.reasoningTokens ?? 0)
                        const cachedTokens = Number(usage?.cachedTokens ?? 0)
                        const cachedShare = inputTokens + cachedTokens > 0 ? (cachedTokens / (inputTokens + cachedTokens)) * 100 : 0
                        const liveCost = Number(cost?.inputCost ?? 0)
                        const cachedCost = Number((cost as any)?.cachedCost ?? (cost as any)?.cachedInputCost ?? 0)
                        const outputCost = Number(cost?.outputCost ?? 0)
                        const totalModelCost = Number(cost?.totalCost ?? liveCost + cachedCost + outputCost)
                        return (
                          <div key={`${provider}-${model}`} style={{ border: '1px solid #2a2a2a', borderRadius: 8, padding: 8 }}>
                            <Text size="xs" fw={600} mb={4}>{model}</Text>
                            <Stack gap={4}>
                              <LabelValueRow
                                label="Input"
                                value={(
                                  <MetricValue
                                    tokens={inputTokens}
                                    cost={liveCost}
                                    currency={currency}
                                    tokensColor="#4fc3f7"
                                    costColor="#4ade80"
                                  />
                                )}
                              />
                              <LabelValueRow
                                label="Cached input"
                                value={(
                                  <MetricValue
                                    tokens={cachedTokens}
                                    cost={cachedCost}
                                    currency={currency}
                                    tokensColor="#ffa726"
                                    costColor="#ffa726"
                                    subtitle={cachedTokens > 0 ? (
                                      <Text size="xs" style={{ color: '#ffa726' }}>{Math.round(cachedShare)}% of input</Text>
                                    ) : undefined}
                                  />
                                )}
                              />
                              <LabelValueRow
                                label="Output"
                                value={(
                                  <MetricValue
                                    tokens={outputTokens}
                                    cost={outputCost}
                                    currency={currency}
                                    tokensColor="#81c784"
                                    costColor="#81c784"
                                    subtitle={reasoningTokens > 0 ? (
                                      <Text size="xs" style={{ color: '#a5d6a7' }}>{formatTokens(reasoningTokens)} thinking</Text>
                                    ) : undefined}
                                  />
                                )}
                              />
                              <LabelValueRow
                                label="Total cost"
                                value={formatCurrency(totalModelCost, currency)}
                                color="#4ade80"
                              />
                            </Stack>
                          </div>
                        )
                      })}
                    </Stack>
                  </Card>
                ))}
              </Stack>
            </Stack>
          )}

          {requestRows.length > 0 && (
            <Stack gap="xs">
              <Group gap={6}>
                <Text size="xs" fw={600} c="orange">REQUESTS THIS SESSION</Text>
                <Badge size="xs" color="orange" variant="light">{requestRows.length}</Badge>
              </Group>
              <Stack gap="xs">
                {requestRows.map((entry, idx) => {
                  const input = Number(entry?.usage?.inputTokens ?? 0)
                  const cachedTokens = Number(entry?.usage?.cachedTokens ?? 0)
                  const output = Number(entry?.usage?.outputTokens ?? 0)
                  const reasoning = Number(entry?.usage?.reasoningTokens ?? 0)

                  const inputCost = Number(entry?.cost?.inputCost ?? 0)
                  const cachedCost = Number((entry?.cost as any)?.cachedCost ?? (entry?.cost as any)?.cachedInputCost ?? 0)
                  const outputCost = Number(entry?.cost?.outputCost ?? 0)

                  const cachedPercent = cachedTokens + input > 0 ? Math.round((cachedTokens / (cachedTokens + input)) * 100) : 0
                  const timestamp = formatTimestamp(entry.timestamp)

                  return (
                    <Card
                      key={`${entry.requestId}:${entry.nodeId}:${entry.executionId}:${idx}`}
                      withBorder
                      padding="xs"
                      radius="sm"
                    >
                      <Group justify="space-between" align="flex-start" gap="sm">
                        <Stack gap={2}>
                          <Text size="sm" fw={600}>{entry.provider} / {entry.model}</Text>
                          {(entry.nodeId || entry.executionId) && (
                            <Text size="xs" c="dimmed">
                              node {entry.nodeId || '—'} · exec {entry.executionId || '—'}
                            </Text>
                          )}
                        </Stack>
                        {(timestamp || cachedPercent > 0) && (
                          <Stack gap={4} align="flex-end">
                            {timestamp && (
                              <Text size="xs" c="dimmed">{timestamp}</Text>
                            )}
                            {cachedPercent > 0 && (
                              <Badge size="xs" color="orange" variant="light">{cachedPercent}% cached</Badge>
                            )}
                          </Stack>
                        )}
                      </Group>
                      <SimpleGrid cols={3} spacing="sm" mt="xs" {...requestMetricsGrid}>
                        <RequestMetric
                          label="Input"
                          tokens={input}
                          cost={inputCost}
                          currency={currency}
                          tokensColor="#4fc3f7"
                          costColor="#4ade80"
                        />
                        <RequestMetric
                          label="Cached input"
                          tokens={cachedTokens}
                          cost={cachedCost}
                          currency={currency}
                          tokensColor="#ffa726"
                          costColor="#ffa726"
                          subtitle={cachedPercent > 0 ? (
                            <Text size="xs" style={{ color: '#ffa726' }}>{cachedPercent}% of input</Text>
                          ) : undefined}
                        />
                        <RequestMetric
                          label="Output"
                          tokens={output}
                          cost={outputCost}
                          currency={currency}
                          tokensColor="#81c784"
                          costColor="#81c784"
                          subtitle={reasoning > 0 ? (
                            <Text size="xs" style={{ color: '#a5d6a7' }}>{formatTokens(reasoning)} thinking</Text>
                          ) : undefined}
                        />
                      </SimpleGrid>
                    </Card>
                  )
                })}
              </Stack>
            </Stack>
          )}
        </Stack>
      </ScrollArea>
    </CollapsiblePanel>
  )
}
