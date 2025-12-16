import { Select, NumberInput, Stack, Text, Switch, Group } from '@mantine/core'

type MemoryItemType = 'decision' | 'constraint' | 'preference' | 'fact' | 'warning' | 'workflow'

const MEMORY_TYPES: MemoryItemType[] = ['decision', 'constraint', 'preference', 'fact', 'warning', 'workflow']

type Props = {
  config: any
  onConfigChange: (patch: any) => void
  providerOptions: Array<{ value: string; label: string }>
  modelOptions: Record<string, Array<{ value: string; label: string }>>
}

export function ExtractMemoriesConfig({ config, onConfigChange, providerOptions, modelOptions }: Props) {
  const provider = (config.provider as string) || providerOptions?.[0]?.value || 'openai'
  const models = modelOptions?.[provider] || []
  const model = (config.model as string) || models?.[0]?.value || 'gpt-4o-mini'

  const enabledTypes: Record<string, boolean> =
    config.enabledTypes && typeof config.enabledTypes === 'object' ? (config.enabledTypes as Record<string, boolean>) : {}

  const setEnabledType = (type: MemoryItemType, enabled: boolean) => {
    onConfigChange({
      enabledTypes: {
        ...enabledTypes,
        [type]: enabled,
      },
    })
  }

  return (
    <Stack gap={8}>
      <Text size="xs" c="dimmed">
        Extracts durable workspace memories from the last N user/assistant message pairs and writes them to
        <code style={{ marginLeft: 6 }}>.hifide-public/memories.json</code>.
      </Text>

      <Select
        label="Provider"
        size="xs"
        value={provider}
        data={providerOptions}
        onChange={(v) => onConfigChange({ provider: v })}
      />

      <Select
        label="Model"
        size="xs"
        value={model}
        data={models}
        onChange={(v) => onConfigChange({ model: v })}
      />

      <NumberInput
        label="Lookback Pairs"
        size="xs"
        min={1}
        max={10}
        value={typeof config.lookbackPairs === 'number' ? config.lookbackPairs : 1}
        onChange={(v) => onConfigChange({ lookbackPairs: typeof v === 'number' ? v : 1 })}
      />

      <Stack gap={4}>
        <Text size="xs" c="dimmed">
          Extraction types
        </Text>
        <Group gap="md" wrap="wrap">
          {MEMORY_TYPES.map((t) => (
            <Switch
              key={t}
              size="xs"
              label={t}
              checked={enabledTypes[t] !== false}
              onChange={(e) => setEnabledType(t, e.currentTarget.checked)}
            />
          ))}
        </Group>
        <Text size="xs" c="dimmed">
          Disabled types will not be written to the workspace memories store by this node.
        </Text>
      </Stack>
    </Stack>
  )
}
