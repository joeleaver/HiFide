import { memo, useEffect, useState } from 'react'
import { Group, Stack, Text, Table, Badge, Collapse, Button, Tooltip } from '@mantine/core'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { getBackendClient } from '../lib/backend/bootstrap'

export interface BadgeUsageBreakdownContentProps {
  badgeId: string
  usageKey: string
}

interface StepCategoryBreakdown {
  systemInstructions: number
  toolDefinitions: number
  userMessages: number
  assistantMessages: number
  assistantReasoning: number
  toolResults: number
  outputText: number
  outputReasoning: number
  outputToolCalls: number
}

interface StepUsage {
  stepNumber: number
  categories: StepCategoryBreakdown
  providerInputTokens: number
  providerOutputTokens: number
  cachedTokens: number
  inputTotal: number
  outputTotal: number
}

interface ResentContext {
  systemInstructions: number
  toolDefinitions: number
  userMessages: number
  assistantMessages: number
  assistantReasoning: number
  toolResults: number
  total: number
}

interface UsageBreakdown {
  input: {
    instructions?: number
    userMessages?: number
    assistantMessages?: number
    toolDefinitions?: number
    responseFormat?: number
    toolCallResults?: number
  }
  output: {
    assistantText?: number
    thoughts?: number
    toolCalls?: number
  }
  tools?: Record<string, {
    calls?: number
    inputResults?: number
    outputArgs?: number
  }>
  totals: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cachedTokens?: number
    costEstimate?: number
    stepCount?: number
  }
  estimated: boolean
  perStep?: StepUsage[]
  resent?: ResentContext
  comparison?: {
    accumulatedInput: number
    uniqueInput: number
    accumulatedOutput: number
    uniqueOutput: number
  }
}

const formatNumber = (n: number | undefined): string => {
  if (n === undefined || n === null) return '—'
  return n.toLocaleString()
}

export const BadgeUsageBreakdownContent = memo(function BadgeUsageBreakdownContent({ badgeId, usageKey }: BadgeUsageBreakdownContentProps) {
  void badgeId

  const [breakdown, setBreakdown] = useState<UsageBreakdown | null>(null)
  const [showSteps, setShowSteps] = useState(false)

  useEffect(() => {
    const client = getBackendClient(); if (!client) return
    client.rpc('tool.getResult', { key: usageKey }).then((res: any) => {
      const data = res?.result ?? res?.data ?? res
      setBreakdown(data)
    }).catch(() => {})
  }, [usageKey])

  if (!breakdown) {
    return <Text size="xs" c="dimmed">No usage data</Text>
  }

  const hasPerStepData = breakdown.perStep && breakdown.perStep.length > 1
  const totals = breakdown.totals || {}
  const comparison = breakdown.comparison
  const resent = breakdown.resent

  // For multi-step requests, show the new per-step table
  if (hasPerStepData && breakdown.perStep) {
    return (
      <Stack gap={6}>
        {/* Summary badges */}
        <Group gap={8} wrap="wrap">
          <Badge size="xs" variant="light" color="orange">
            {breakdown.perStep.length} Steps
          </Badge>
          {comparison && (
            <>
              <Tooltip label="Final step's input tokens (what billing is based on)">
                <Badge size="xs" variant="light" color="indigo">
                  Unique Input: {formatNumber(comparison.uniqueInput)}
                </Badge>
              </Tooltip>
              <Tooltip label="Sum of all steps' input tokens (includes re-sent context)">
                <Badge size="xs" variant="light" color="gray">
                  Accumulated: {formatNumber(comparison.accumulatedInput)}
                </Badge>
              </Tooltip>
            </>
          )}
          <Badge size="xs" variant="light" color="green">
            Output: {formatNumber(totals.outputTokens)}
          </Badge>
          {totals.cachedTokens !== undefined && totals.cachedTokens > 0 && (
            <Badge size="xs" variant="light" color="yellow">
              Cached: {formatNumber(totals.cachedTokens)}
            </Badge>
          )}
          <Badge size="xs" variant="light" color="gray">
            Estimated: {breakdown.estimated ? 'Yes' : 'No'}
          </Badge>
        </Group>

        {/* Per-step table toggle */}
        <Button
          variant="subtle"
          size="xs"
          leftSection={showSteps ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          onClick={() => setShowSteps(!showSteps)}
          style={{ alignSelf: 'flex-start' }}
        >
          {showSteps ? 'Hide' : 'Show'} Step Details
        </Button>

        {/* Per-step breakdown table */}
        <Collapse in={showSteps}>
          <Stack gap={8}>
            <Table striped highlightOnHover withTableBorder withColumnBorders style={{ fontSize: '11px' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th rowSpan={2} style={{ width: 50, verticalAlign: 'bottom' }}>Step</Table.Th>
                  <Table.Th colSpan={6} style={{ textAlign: 'center', borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
                    <Text size="xs" fw={600} c="indigo">Input (sent to model)</Text>
                  </Table.Th>
                  <Table.Th colSpan={3} style={{ textAlign: 'center', borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
                    <Text size="xs" fw={600} c="green">Output (from model)</Text>
                  </Table.Th>
                  <Table.Th rowSpan={2} style={{ width: 60, textAlign: 'right', verticalAlign: 'bottom' }}>Cached</Table.Th>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th style={{ width: 55, textAlign: 'right' }}>
                    <Tooltip label="System instructions (re-sent each step)"><Text size="xs">Sys</Text></Tooltip>
                  </Table.Th>
                  <Table.Th style={{ width: 55, textAlign: 'right' }}>
                    <Tooltip label="Tool definitions (re-sent each step)"><Text size="xs">Tools</Text></Tooltip>
                  </Table.Th>
                  <Table.Th style={{ width: 55, textAlign: 'right' }}>
                    <Tooltip label="User messages"><Text size="xs">User</Text></Tooltip>
                  </Table.Th>
                  <Table.Th style={{ width: 55, textAlign: 'right' }}>
                    <Tooltip label="Previous assistant responses (grows each step)"><Text size="xs">Asst</Text></Tooltip>
                  </Table.Th>
                  <Table.Th style={{ width: 55, textAlign: 'right' }}>
                    <Tooltip label="Previous assistant reasoning/thinking (grows each step)"><Text size="xs">Think</Text></Tooltip>
                  </Table.Th>
                  <Table.Th style={{ width: 60, textAlign: 'right' }}>
                    <Tooltip label="Tool results from previous steps (grows each step)"><Text size="xs">Results</Text></Tooltip>
                  </Table.Th>
                  <Table.Th style={{ width: 55, textAlign: 'right' }}>
                    <Tooltip label="Assistant text output this step"><Text size="xs">Text</Text></Tooltip>
                  </Table.Th>
                  <Table.Th style={{ width: 55, textAlign: 'right' }}>
                    <Tooltip label="Reasoning/thinking tokens this step"><Text size="xs">Think</Text></Tooltip>
                  </Table.Th>
                  <Table.Th style={{ width: 55, textAlign: 'right' }}>
                    <Tooltip label="Tool call arguments this step"><Text size="xs">Calls</Text></Tooltip>
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {breakdown.perStep.map((step) => (
                  <Table.Tr key={step.stepNumber}>
                    <Table.Td>
                      <Text size="xs" fw={500}>Step {step.stepNumber}</Text>
                    </Table.Td>
                    {/* Input categories */}
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c="indigo.4">{formatNumber(step.categories.systemInstructions)}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c="indigo.4">{formatNumber(step.categories.toolDefinitions)}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c="indigo.4">{formatNumber(step.categories.userMessages)}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c="indigo.4">{formatNumber(step.categories.assistantMessages)}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c="indigo.4">{formatNumber(step.categories.assistantReasoning)}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c="indigo.4">{formatNumber(step.categories.toolResults)}</Text>
                    </Table.Td>
                    {/* Output categories */}
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c="green.4">{formatNumber(step.categories.outputText)}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c="green.4">{formatNumber(step.categories.outputReasoning)}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c="green.4">{formatNumber(step.categories.outputToolCalls)}</Text>
                    </Table.Td>
                    {/* Cached */}
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c={step.cachedTokens > 0 ? 'yellow.4' : 'dimmed'}>
                        {formatNumber(step.cachedTokens)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {/* Totals row - sum of all columns */}
                {(() => {
                  const steps = breakdown.perStep!
                  const sumSys = steps.reduce((s, x) => s + x.categories.systemInstructions, 0)
                  const sumTools = steps.reduce((s, x) => s + x.categories.toolDefinitions, 0)
                  const sumUser = steps.reduce((s, x) => s + x.categories.userMessages, 0)
                  const sumAsst = steps.reduce((s, x) => s + x.categories.assistantMessages, 0)
                  const sumThink = steps.reduce((s, x) => s + x.categories.assistantReasoning, 0)
                  const sumResults = steps.reduce((s, x) => s + x.categories.toolResults, 0)
                  const sumOutText = steps.reduce((s, x) => s + x.categories.outputText, 0)
                  const sumOutThink = steps.reduce((s, x) => s + x.categories.outputReasoning, 0)
                  const sumOutCalls = steps.reduce((s, x) => s + x.categories.outputToolCalls, 0)
                  const sumCached = steps.reduce((s, x) => s + x.cachedTokens, 0)
                  return (
                    <Table.Tr style={{ backgroundColor: 'var(--mantine-color-gray-light)', borderTop: '2px solid var(--mantine-color-dark-4)' }}>
                      <Table.Td>
                        <Tooltip label="Sum of all steps (accumulated total)">
                          <Text size="xs" fw={700}>Total</Text>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}><Text size="xs" fw={600} c="indigo">{formatNumber(sumSys)}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}><Text size="xs" fw={600} c="indigo">{formatNumber(sumTools)}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}><Text size="xs" fw={600} c="indigo">{formatNumber(sumUser)}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}><Text size="xs" fw={600} c="indigo">{formatNumber(sumAsst)}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}><Text size="xs" fw={600} c="indigo">{formatNumber(sumThink)}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}><Text size="xs" fw={600} c="indigo">{formatNumber(sumResults)}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}><Text size="xs" fw={600} c="green">{formatNumber(sumOutText)}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}><Text size="xs" fw={600} c="green">{formatNumber(sumOutThink)}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}><Text size="xs" fw={600} c="green">{formatNumber(sumOutCalls)}</Text></Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}><Text size="xs" fw={600} c="yellow">{formatNumber(sumCached)}</Text></Table.Td>
                    </Table.Tr>
                  )
                })()}
                {/* Re-sent row showing overhead (what was sent multiple times) */}
                {resent && resent.total > 0 && (
                  <Table.Tr style={{ backgroundColor: 'var(--mantine-color-red-light)' }}>
                    <Table.Td>
                      <Tooltip label="Tokens sent multiple times (overhead from context re-sending in multi-step requests)">
                        <Text size="xs" fw={600} c="red.4">Overhead</Text>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c="red.4">{formatNumber(resent.systemInstructions)}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c="red.4">{formatNumber(resent.toolDefinitions)}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c="red.4">{formatNumber(resent.userMessages)}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c="red.4">{formatNumber(resent.assistantMessages)}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c="red.4">{formatNumber(resent.assistantReasoning)}</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" c="red.4">{formatNumber(resent.toolResults)}</Text>
                    </Table.Td>
                    {/* Empty output columns - outputs are never re-sent */}
                    <Table.Td style={{ textAlign: 'right' }}><Text size="xs" c="dimmed">—</Text></Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}><Text size="xs" c="dimmed">—</Text></Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}><Text size="xs" c="dimmed">—</Text></Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="xs" fw={600} c="red.4">{formatNumber(resent.total)}</Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>

            {/* Per-tool breakdown (if available) */}
            {breakdown.tools && Object.keys(breakdown.tools).length > 0 && (
              <Table striped highlightOnHover withTableBorder withColumnBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ width: 200 }}>Tool</Table.Th>
                    <Table.Th style={{ width: 70 }}>Calls</Table.Th>
                    <Table.Th style={{ width: 120 }}>Input (results)</Table.Th>
                    <Table.Th style={{ width: 120 }}>Output (args)</Table.Th>
                    <Table.Th align="right">Total</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {Object.entries(breakdown.tools).map(([name, info]: any, idx) => {
                    const calls = info?.calls || 0
                    const inTok = info?.inputResults || 0
                    const outTok = info?.outputArgs || 0
                    const total = inTok + outTok
                    return (
                      <Table.Tr key={idx}>
                        <Table.Td><Text size="xs">{name}</Text></Table.Td>
                        <Table.Td><Text size="xs">{calls}</Text></Table.Td>
                        <Table.Td><Text size="xs">{formatNumber(inTok)}</Text></Table.Td>
                        <Table.Td><Text size="xs">{formatNumber(outTok)}</Text></Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}><Text size="xs">{formatNumber(total)}</Text></Table.Td>
                      </Table.Tr>
                    )
                  })}
                </Table.Tbody>
              </Table>
            )}
          </Stack>
        </Collapse>
      </Stack>
    )
  }

  // Single-step or legacy display (existing code)
  const input = breakdown.input || {}
  const output = breakdown.output || {}

  const rows: Array<{ label: string; value: number | undefined; section: 'Input' | 'Output' }> = [
    { label: 'System instructions', value: input.instructions, section: 'Input' },
    { label: 'User messages', value: input.userMessages, section: 'Input' },
    { label: 'Assistant messages', value: input.assistantMessages, section: 'Input' },
    { label: 'Tool definitions', value: input.toolDefinitions, section: 'Input' },
    { label: 'Response format', value: input.responseFormat, section: 'Input' },
    { label: 'Tool call results', value: input.toolCallResults, section: 'Input' },
    { label: 'Assistant text', value: output.assistantText, section: 'Output' },
    { label: 'Thoughts', value: output.thoughts, section: 'Output' },
    { label: 'Tool calls (args)', value: output.toolCalls, section: 'Output' },
  ]

  const inputTotal = rows.filter(r => r.section === 'Input').reduce((acc, r) => acc + (r.value || 0), 0)
  const outputTotal = rows.filter(r => r.section === 'Output').reduce((acc, r) => acc + (r.value || 0), 0)
  const cachedInput = Number(totals.cachedTokens || 0)
  const structuralOverhead = Math.max(0, Number(totals.inputTokens || 0) - inputTotal - cachedInput)

  return (
    <Stack gap={6}>
      <Group gap={8} wrap="wrap">
        <Badge size="xs" variant="light" color="gray">Estimated: {breakdown.estimated ? 'Yes' : 'No'}</Badge>
        {typeof totals.inputTokens === 'number' && (
          <Badge size="xs" variant="light" color="indigo">Input: {formatNumber(totals.inputTokens)}</Badge>
        )}
        {typeof totals.outputTokens === 'number' && (
          <Badge size="xs" variant="light" color="green">Output: {formatNumber(totals.outputTokens)}</Badge>
        )}
        {typeof totals.totalTokens === 'number' && (
          <Badge size="xs" variant="light" color="grape">Total: {formatNumber(totals.totalTokens)}</Badge>
        )}
        {typeof totals.costEstimate === 'number' && (
          <Badge size="xs" variant="light" color="teal">Cost: ${totals.costEstimate.toFixed(4)}</Badge>
        )}
        {typeof totals.stepCount === 'number' && totals.stepCount > 0 && (
          <Badge size="xs" variant="light" color="orange">Steps: {totals.stepCount}</Badge>
        )}
      </Group>

      <Table striped highlightOnHover withTableBorder withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: 160 }}>Category</Table.Th>
            <Table.Th style={{ width: 80 }}>Side</Table.Th>
            <Table.Th align="right">Tokens</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r, idx) => (
            <Table.Tr key={idx}>
              <Table.Td>
                <Text size="xs" c="dimmed">{r.label}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs">{r.section}</Text>
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <Text size="xs">{formatNumber(r.value)}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
          <Table.Tr>
            <Table.Td>
              <Text size="xs" fw={600}>Subtotal</Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs" fw={600}>Input</Text>
            </Table.Td>
            <Table.Td style={{ textAlign: 'right' }}>
              <Text size="xs" fw={600}>{formatNumber(inputTotal)}</Text>
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>
              <Text size="xs" fw={600}>Subtotal</Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs" fw={600}>Output</Text>
            </Table.Td>
            <Table.Td style={{ textAlign: 'right' }}>
              <Text size="xs" fw={600}>{formatNumber(outputTotal)}</Text>
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>
              <Text size="xs" c="dimmed">Cached input</Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs">Input</Text>
            </Table.Td>
            <Table.Td style={{ textAlign: 'right' }}>
              <Text size="xs">{formatNumber(cachedInput)}</Text>
            </Table.Td>
          </Table.Tr>
          {structuralOverhead > 0 && (
            <Table.Tr>
              <Table.Td>
                <Text size="xs" c="dimmed">Unaccounted input</Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs">Input</Text>
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <Text size="xs">{formatNumber(structuralOverhead)}</Text>
              </Table.Td>
            </Table.Tr>
          )}
          <Table.Tr>
            <Table.Td>
              <Text size="xs" fw={600}>Provider total</Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs" fw={600}>Input</Text>
            </Table.Td>
            <Table.Td style={{ textAlign: 'right' }}>
              <Text size="xs" fw={600}>{formatNumber(totals.inputTokens)}</Text>
            </Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>

      {/* Agentic loop metadata */}
      {typeof totals.stepCount === 'number' && totals.stepCount > 0 && (
        <Table striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 160 }}>Metadata</Table.Th>
              <Table.Th align="right">Value</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td>
                <Text size="xs" c="dimmed">Agentic steps</Text>
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <Text size="xs" fw={600}>{totals.stepCount}</Text>
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      )}

      {/* Per-tool breakdown */}
      {breakdown.tools && Object.keys(breakdown.tools).length > 0 && (
        <Table striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 200 }}>Tool</Table.Th>
              <Table.Th style={{ width: 70 }}>Calls</Table.Th>
              <Table.Th style={{ width: 120 }}>Input (results)</Table.Th>
              <Table.Th style={{ width: 120 }}>Output (args)</Table.Th>
              <Table.Th align="right">Total</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {Object.entries(breakdown.tools).map(([name, info]: any, idx) => {
              const calls = info?.calls || 0
              const inTok = info?.inputResults || 0
              const outTok = info?.outputArgs || 0
              const total = inTok + outTok
              return (
                <Table.Tr key={idx}>
                  <Table.Td><Text size="xs">{name}</Text></Table.Td>
                  <Table.Td><Text size="xs">{calls}</Text></Table.Td>
                  <Table.Td><Text size="xs">{formatNumber(inTok)}</Text></Table.Td>
                  <Table.Td><Text size="xs">{formatNumber(outTok)}</Text></Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}><Text size="xs">{formatNumber(total)}</Text></Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      )}

    </Stack>
  )
})
