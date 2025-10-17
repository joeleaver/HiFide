import { useMemo, useState } from 'react'
import type { RateLimitKind } from '../store'

import { Card, Stack, Group, Text, Accordion, Table, NumberInput, Switch, Badge } from '@mantine/core'
import { useAppStore, useDispatch, selectModelsByProvider, selectRateLimitConfig } from '../store'

export default function RateLimitSettings() {
  // Use selectors for better performance
  const modelsByProvider = useAppStore(selectModelsByProvider)
  const rateLimitConfig = useAppStore(selectRateLimitConfig)

  // Use dispatch to call actions
  const dispatch = useDispatch()

  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <Card withBorder style={{ backgroundColor: '#1e1e1e', borderColor: '#3e3e42' }}>
      <Stack gap="md">
        <Group justify="space-between">
          <div>
            <Text size="sm" fw={600} c="#cccccc">Rate Limits (optional)</Text>
            <Text size="xs" c="dimmed">
              Configure per-model limits to avoid exceeding provider quotas. Leave fields blank to ignore a limit.
            </Text>
          </div>
          <Group gap="md">
            {rateLimitConfig.enabled ? <Badge size="xs" color="green">Enabled</Badge> : <Badge size="xs" color="gray">Disabled</Badge>}
            <Switch
              size="sm"
              checked={!!rateLimitConfig.enabled}
              onChange={(e) => dispatch('toggleRateLimiting', e.currentTarget.checked)}
              onLabel="On"
              offLabel="Off"
            />
          </Group>
        </Group>

        <Accordion
          value={expanded}
          onChange={setExpanded}
          styles={{
            item: { backgroundColor: '#252526', border: '1px solid #3e3e42', marginBottom: '8px' },
            control: { color: '#cccccc', '&:hover': { backgroundColor: '#2d2d30' } },
            content: { padding: '12px' },
          }}
        >
          <ProviderLimits provider="openai" title="OpenAI Models" models={modelsByProvider.openai || []} />
          <ProviderLimits provider="anthropic" title="Anthropic Models" models={modelsByProvider.anthropic || []} />
          <ProviderLimits provider="gemini" title="Google Gemini Models" models={modelsByProvider.gemini || []} />
        </Accordion>
      </Stack>
    </Card>
  )
}

function ProviderLimits({ provider, title, models }: { provider: 'openai'|'anthropic'|'gemini'; title: string; models: Array<{ value: string; label: string }> }) {
  const rateLimitConfig = useAppStore((s) => s.rateLimitConfig)
  const dispatch = useDispatch()

  // Show all available models (same as in Pricing)
  const rows = useMemo(() => {
    return models
  }, [models])

  if (!rows.length) {
    return (
      <Accordion.Item value={provider}>
        <Accordion.Control>
          <Text size="sm" c="#cccccc">{title}</Text>
        </Accordion.Control>
        <Accordion.Panel>
          <Text size="sm" c="dimmed" ta="center" py="md">
            No models available. Add an API key for this provider to see available models.
          </Text>
        </Accordion.Panel>
      </Accordion.Item>
    )
  }

  const provLimits: Record<string, RateLimitKind> = (rateLimitConfig as any)?.[provider] || {}

  return (
    <Accordion.Item value={provider}>
      <Accordion.Control>
        <Text size="sm" c="#cccccc">{title}</Text>
      </Accordion.Control>
      <Accordion.Panel>
        <Table
          styles={{
            table: { backgroundColor: '#1e1e1e' },
            th: { color: '#cccccc', backgroundColor: '#252526', borderBottom: '1px solid #3e3e42' },
            td: { color: '#cccccc', borderBottom: '1px solid #3e3e42' },
          }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Model</Table.Th>
              <Table.Th>RPM</Table.Th>
              <Table.Th>TPM (total)</Table.Th>
              <Table.Th>TPM (input)</Table.Th>
              <Table.Th>TPM (output)</Table.Th>
              <Table.Th>Max Concurrent</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((m) => {
              const limits: RateLimitKind = provLimits[m.value] || {}
              return (
                <Table.Tr key={m.value}>
                  <Table.Td><Text size="xs" c="#cccccc">{m.label}</Text></Table.Td>
                  <Table.Td>
                    <NumberInput size="xs" value={limits.rpm ?? '' as any} onChange={(v) => dispatch('setRateLimitForModel', { provider, model: m.value, limits: { ...limits, rpm: typeof v === 'number' ? v : undefined } })} min={0} step={1}
                      styles={{ input: { backgroundColor: '#252526', border: '1px solid #3e3e42', color: '#cccccc' } }} />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput size="xs" value={limits.tpmTotal ?? '' as any} onChange={(v) => dispatch('setRateLimitForModel', { provider, model: m.value, limits: { ...limits, tpmTotal: typeof v === 'number' ? v : undefined } })} min={0} step={100}
                      styles={{ input: { backgroundColor: '#252526', border: '1px solid #3e3e42', color: '#cccccc' } }} />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput size="xs" value={limits.tpmInput ?? '' as any} onChange={(v) => dispatch('setRateLimitForModel', { provider, model: m.value, limits: { ...limits, tpmInput: typeof v === 'number' ? v : undefined } })} min={0} step={100}
                      styles={{ input: { backgroundColor: '#252526', border: '1px solid #3e3e42', color: '#cccccc' } }} />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput size="xs" value={limits.tpmOutput ?? '' as any} onChange={(v) => dispatch('setRateLimitForModel', { provider, model: m.value, limits: { ...limits, tpmOutput: typeof v === 'number' ? v : undefined } })} min={0} step={100}
                      styles={{ input: { backgroundColor: '#252526', border: '1px solid #3e3e42', color: '#cccccc' } }} />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput size="xs" value={limits.maxConcurrent ?? '' as any} onChange={(v) => dispatch('setRateLimitForModel', { provider, model: m.value, limits: { ...limits, maxConcurrent: typeof v === 'number' ? v : undefined } })} min={0} step={1}
                      styles={{ input: { backgroundColor: '#252526', border: '1px solid #3e3e42', color: '#cccccc' } }} />
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </Accordion.Panel>
    </Accordion.Item>
  )
}

