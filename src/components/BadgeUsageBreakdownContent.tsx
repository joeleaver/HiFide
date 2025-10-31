import { memo, useEffect } from 'react'
import { Group, Stack, Text, Table, Badge } from '@mantine/core'
import { useAppStore, useDispatch } from '../store'

export interface BadgeUsageBreakdownContentProps {
  badgeId: string
  usageKey: string
}

export const BadgeUsageBreakdownContent = memo(function BadgeUsageBreakdownContent({ badgeId, usageKey }: BadgeUsageBreakdownContentProps) {
  void badgeId
  const dispatch = useDispatch()

  useEffect(() => {
    const existing = (useAppStore as any).getState().feLoadedToolResults?.[usageKey]
    if (existing === undefined) {
      dispatch('loadToolResult', { key: usageKey })
    }
  }, [usageKey])

  const breakdown = useAppStore((s) => (s as any).feLoadedToolResults?.[usageKey] || null) as any

  if (!breakdown) {
    return <Text size="xs" c="dimmed">No usage data</Text>
  }

  const input = breakdown.input || {}
  const output = breakdown.output || {}
  const totals = breakdown.totals || {}

  const rows: Array<{ label: string; value: number | undefined; section: 'Input' | 'Output' }> = [
    { label: 'System instructions', value: input.instructions, section: 'Input' },
    { label: 'User messages', value: input.userMessages, section: 'Input' },
    { label: 'Assistant messages', value: input.assistantMessages, section: 'Input' },
    { label: 'Tool definitions', value: input.toolDefinitions, section: 'Input' },
    { label: 'Response format', value: input.responseFormat, section: 'Input' },
    { label: 'Tool call results', value: input.toolCallResults, section: 'Input' },
    { label: 'Assistant text', value: output.assistantText, section: 'Output' },
    { label: 'Tool calls (args)', value: output.toolCalls, section: 'Output' },
  ]

  const inputTotal = rows.filter(r => r.section === 'Input').reduce((acc, r) => acc + (r.value || 0), 0)
  const outputTotal = rows.filter(r => r.section === 'Output').reduce((acc, r) => acc + (r.value || 0), 0)
  const cachedInput = Number(totals.cachedInputTokens || 0)
  const structuralOverhead = Math.max(0, Number(totals.inputTokens || 0) - inputTotal - cachedInput)

  return (
    <Stack gap={6}>
      <Group gap={8} wrap="wrap">
        <Badge size="xs" variant="light" color="gray">Estimated: {breakdown.estimated ? 'Yes' : 'No'}</Badge>
        {typeof totals.inputTokens === 'number' && (
          <Badge size="xs" variant="light" color="indigo">Input: {totals.inputTokens.toLocaleString()} tok</Badge>
        )}
        {typeof totals.outputTokens === 'number' && (
          <Badge size="xs" variant="light" color="green">Output: {totals.outputTokens.toLocaleString()} tok</Badge>
        )}
        {typeof totals.totalTokens === 'number' && (
          <Badge size="xs" variant="light" color="grape">Total: {totals.totalTokens.toLocaleString()} tok</Badge>
        )}
        {typeof totals.costEstimate === 'number' && (
          <Badge size="xs" variant="light" color="teal">Cost: ${totals.costEstimate.toFixed(4)}</Badge>
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
                <Text size="xs">{typeof r.value === 'number' ? r.value.toLocaleString() : '—'}</Text>
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
              <Text size="xs" fw={600}>{inputTotal.toLocaleString()}</Text>
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
              <Text size="xs" fw={600}>{outputTotal.toLocaleString()}</Text>
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>
              <Text size="xs" c="dimmed">Cached input (subset)</Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs">Input</Text>
            </Table.Td>
            <Table.Td style={{ textAlign: 'right' }}>
              <Text size="xs">{cachedInput.toLocaleString()}</Text>
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>
              <Text size="xs" c="dimmed">Structural / overhead</Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs">Input</Text>
            </Table.Td>
            <Table.Td style={{ textAlign: 'right' }}>
              <Text size="xs">{structuralOverhead.toLocaleString()}</Text>
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>
              <Text size="xs" fw={600}>Provider total</Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs" fw={600}>Input</Text>
            </Table.Td>
            <Table.Td style={{ textAlign: 'right' }}>
              <Text size="xs" fw={600}>{Number(totals.inputTokens || 0).toLocaleString()}</Text>
            </Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>

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
                  <Table.Td><Text size="xs">{inTok.toLocaleString()}</Text></Table.Td>
                  <Table.Td><Text size="xs">{outTok.toLocaleString()}</Text></Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}><Text size="xs">{total.toLocaleString()}</Text></Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      )}

    </Stack>
  )
})

