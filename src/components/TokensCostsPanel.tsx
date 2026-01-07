import { ScrollArea, Stack, Text, Table } from '@mantine/core'
import React, { useState } from 'react'
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

const formatTokens = (value?: number) => (Number.isFinite(value) ? Number(value).toLocaleString() : '0')
const formatCost = (value: number, currency = 'USD') => {
  const amount = Number.isFinite(value) ? value : 0
  const prefix = currency === 'USD' ? '$' : ''
  return `${prefix}${amount.toFixed(5)}`
}

// Group requests by executionId
type ExecutionGroup = {
  executionId: string
  nodeId: string
  provider: string
  model: string
  requests: Array<{
    timestamp: number
    requestId: string
    usage: TokenUsage
    cost: CostBreakdown
  }>
  // Subtotals for this execution group
  subtotals: {
    usage: TokenUsage
    cost: CostBreakdown
  }
}

interface TokensCostsPanelProps {
  isFloating?: boolean
}

export default function TokensCostsPanel({ isFloating = false }: TokensCostsPanelProps) {
  const collapsed = useUiStore((s) => s.tokensCostsCollapsed)
  const height = useUiStore((s) => s.tokensCostsHeight)
  const setCollapsed = useUiStore((s) => s.setTokensCostsCollapsed)
  const setHeight = useUiStore((s) => s.setTokensCostsHeight)

  const tokenUsage = useSessionUi((s: any) => s.tokenUsage) as {
    total: TokenUsage
    byProvider: Record<string, TokenUsage>
    byProviderAndModel: Record<string, Record<string, TokenUsage>>
  } | null
  const costs = (useSessionUi((s: any) => s.costs) as any) || DEFAULT_COSTS
  const requestsLog = (useSessionUi((s: any) => s.requestsLog) as any) || []

  const totalUsage = tokenUsage?.total ?? DEFAULT_USAGE
  const totalInput = Number(totalUsage.inputTokens ?? 0)
  const totalCached = Number(totalUsage.cachedTokens ?? 0)
  const totalOutput = Number(totalUsage.outputTokens ?? 0)

  const currency = typeof costs?.currency === 'string' ? costs.currency : 'USD'
  const inputCost = Number(costs?.inputCost ?? 0)
  const cachedCost = Number(costs?.cachedCost ?? 0)
  const outputCost = Number(costs?.outputCost ?? 0)

  const hasUsage = totalInput > 0 || totalOutput > 0 || totalCached > 0 || Array.isArray(requestsLog) && requestsLog.length > 0

  // Group requests by executionId and calculate subtotals
  const executionGroups = (() => {
    const groups: Record<string, ExecutionGroup> = {}

    if (Array.isArray(requestsLog)) {
      requestsLog.forEach((req: any) => {
        const execId = req.executionId || 'unknown'
        if (!groups[execId]) {
          groups[execId] = {
            executionId: execId,
            nodeId: req.nodeId || 'unknown',
            provider: req.provider || 'unknown',
            model: req.model || 'unknown',
            requests: [],
            subtotals: {
              usage: { ...DEFAULT_USAGE },
              cost: { ...DEFAULT_COSTS }
            }
          }
        }

        const reqUsage = req.usage || DEFAULT_USAGE
        const reqCost = req.cost || DEFAULT_COSTS

        groups[execId].requests.push({
          timestamp: req.timestamp || Date.now(),
          requestId: req.requestId || 'unknown',
          usage: reqUsage,
          cost: reqCost
        })

        // Update subtotals
        const sub = groups[execId].subtotals
        sub.usage.inputTokens += reqUsage.inputTokens || 0
        sub.usage.cachedTokens += reqUsage.cachedTokens || 0
        sub.usage.outputTokens += reqUsage.outputTokens || 0
        sub.usage.totalTokens += reqUsage.totalTokens || 0
        sub.usage.reasoningTokens = (sub.usage.reasoningTokens || 0) + (reqUsage.reasoningTokens || 0)

        sub.cost.inputCost += reqCost.inputCost || 0
        sub.cost.cachedCost += reqCost.cachedCost || 0
        sub.cost.outputCost += reqCost.outputCost || 0
        sub.cost.totalCost += reqCost.totalCost || 0
      })
    }

    return Object.values(groups)
  })()

  // Initialize expandedExecutions with all execution IDs (all expanded by default)
  const [expandedExecutions, setExpandedExecutions] = useState<Set<string>>(() => {
    return new Set(executionGroups.map(g => g.executionId))
  })

  const toggleExecution = (executionId: string) => {
    const newExpanded = new Set(expandedExecutions)
    if (newExpanded.has(executionId)) {
      newExpanded.delete(executionId)
    } else {
      newExpanded.add(executionId)
    }
    setExpandedExecutions(newExpanded)
  }

  const content = (
    <ScrollArea style={{ height: '100%' }} type="auto">
      <Stack gap={0} style={{ padding: '8px' }}>
        {hasUsage ? (
            <Table striped>
              <Table.Tbody>
                {/* Header row */}
                <Table.Tr style={{ backgroundColor: '#1a1a1a', fontWeight: 600 }}>
                  <Table.Td style={{ padding: '6px 8px', fontSize: '11px', fontWeight: 600 }}>Provider / Model</Table.Td>
                  <Table.Td style={{ padding: '6px 8px', fontSize: '11px', fontWeight: 600, textAlign: 'right' }}>Input Tokens</Table.Td>
                  <Table.Td style={{ padding: '6px 8px', fontSize: '11px', fontWeight: 600, textAlign: 'right' }}>Cached Tokens</Table.Td>
                  <Table.Td style={{ padding: '6px 8px', fontSize: '11px', fontWeight: 600, textAlign: 'right' }}>Output Tokens</Table.Td>
                  <Table.Td style={{ padding: '6px 8px', fontSize: '11px', fontWeight: 600, textAlign: 'right' }}>Input Cost</Table.Td>
                  <Table.Td style={{ padding: '6px 8px', fontSize: '11px', fontWeight: 600, textAlign: 'right' }}>Cached Cost</Table.Td>
                  <Table.Td style={{ padding: '6px 8px', fontSize: '11px', fontWeight: 600, textAlign: 'right' }}>Output Cost</Table.Td>
                  <Table.Td style={{ padding: '6px 8px', fontSize: '11px', fontWeight: 600, textAlign: 'right' }}>Total Cost</Table.Td>
                </Table.Tr>

                {/* TOTAL data row */}
                <Table.Tr style={{ backgroundColor: 'rgba(79, 195, 247, 0.05)' }}>
                  <Table.Td style={{ padding: '6px 8px' }}>
                    <Text size="xs" fw={600}>TOTAL</Text>
                  </Table.Td>
                  <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    <Text size="xs" c="#4fc3f7">{formatTokens(totalInput)}</Text>
                  </Table.Td>
                  <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    <Text size="xs" c={totalCached > 0 ? '#ffa726' : 'dimmed'}>{formatTokens(totalCached)}</Text>
                  </Table.Td>
                  <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    <Text size="xs" c="#81c784">{formatTokens(totalOutput)}</Text>
                  </Table.Td>
                  <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    <Text size="xs" c="dimmed">{formatCost(inputCost, currency)}</Text>
                  </Table.Td>
                  <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    <Text size="xs" c="dimmed">{formatCost(cachedCost, currency)}</Text>
                  </Table.Td>
                  <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    <Text size="xs" c="dimmed">{formatCost(outputCost, currency)}</Text>
                  </Table.Td>
                  <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    <Text size="xs" fw={600} c="#fff">{formatCost(inputCost + cachedCost + outputCost, currency)}</Text>
                  </Table.Td>
                </Table.Tr>

                {/* EXECUTION GROUPS */}
                {executionGroups.map((group) => (
                  <React.Fragment key={group.executionId}>
                    {/* Collapsable header with subtotals */}
                    <Table.Tr
                      onClick={() => toggleExecution(group.executionId)}
                      style={{
                        backgroundColor: 'rgba(100, 100, 100, 0.1)',
                        cursor: 'pointer',
                        userSelect: 'none',
                        borderTop: '1px solid #333'
                      }}
                    >
                      <Table.Td style={{ padding: '6px 8px', lineHeight: '1.2' }}>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '11px', fontWeight: 500 }}>
                          {expandedExecutions.has(group.executionId) ? '▼' : '▶'} {group.provider} / {group.model}
                        </div>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '11px', color: '#999' }}>
                          {group.nodeId}
                        </div>
                      </Table.Td>
                      <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        <Text size="xs" c="#4fc3f7">{formatTokens(group.subtotals.usage.inputTokens)}</Text>
                      </Table.Td>
                      <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        <Text size="xs" c={group.subtotals.usage.cachedTokens > 0 ? '#ffa726' : 'dimmed'}>{formatTokens(group.subtotals.usage.cachedTokens)}</Text>
                      </Table.Td>
                      <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        <Text size="xs" c="#81c784">{formatTokens(group.subtotals.usage.outputTokens)}</Text>
                      </Table.Td>
                      <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        <Text size="xs" c="dimmed">{formatCost(group.subtotals.cost.inputCost, currency)}</Text>
                      </Table.Td>
                      <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        <Text size="xs" c="dimmed">{formatCost(group.subtotals.cost.cachedCost, currency)}</Text>
                      </Table.Td>
                      <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        <Text size="xs" c="dimmed">{formatCost(group.subtotals.cost.outputCost, currency)}</Text>
                      </Table.Td>
                      <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        <Text size="xs" fw={600} c="#fff">{formatCost(group.subtotals.cost.inputCost + group.subtotals.cost.cachedCost + group.subtotals.cost.outputCost, currency)}</Text>
                      </Table.Td>
                    </Table.Tr>

                    {/* Expanded content - request rows */}
                    {expandedExecutions.has(group.executionId) && group.requests.map((req, idx) => (
                      <Table.Tr key={idx}>
                        <Table.Td style={{ padding: '6px 8px' }}>
                          <Text size="xs" c="dimmed">Turn {idx + 1}</Text>
                        </Table.Td>
                        <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                          <Text size="xs" c="#4fc3f7">{formatTokens(req.usage.inputTokens)}</Text>
                        </Table.Td>
                        <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                          <Text size="xs" c={req.usage.cachedTokens > 0 ? '#ffa726' : 'dimmed'}>{formatTokens(req.usage.cachedTokens)}</Text>
                        </Table.Td>
                        <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                          <Text size="xs" c="#81c784">{formatTokens(req.usage.outputTokens)}</Text>
                        </Table.Td>
                        <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                          <Text size="xs" c="dimmed">{formatCost(req.cost.inputCost, currency)}</Text>
                        </Table.Td>
                        <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                          <Text size="xs" c="dimmed">{formatCost(req.cost.cachedCost, currency)}</Text>
                        </Table.Td>
                        <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                          <Text size="xs" c="dimmed">{formatCost(req.cost.outputCost, currency)}</Text>
                        </Table.Td>
                        <Table.Td style={{ padding: '6px 8px', textAlign: 'right' }}>
                          <Text size="xs" fw={500} c="#fff">{formatCost(Number(req.cost.inputCost ?? 0) + Number(req.cost.cachedCost ?? 0) + Number(req.cost.outputCost ?? 0), currency)}</Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </React.Fragment>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <Text size="xs" c="dimmed" style={{ textAlign: 'center', padding: '20px 0' }}>
              No token usage yet
            </Text>
          )}
        </Stack>
      </ScrollArea>
    )

  if (isFloating) {
    return content
  }

  return (
    <CollapsiblePanel
      title="TOKENS & COSTS"
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed(!collapsed)}
      height={height}
      onHeightChange={setHeight}
      minHeight={100}
      maxHeight={600}
    >
      {content}
    </CollapsiblePanel>
  )
}
