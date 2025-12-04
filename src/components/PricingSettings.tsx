import { useState } from 'react'
import { Card, Stack, Group, Text, Button, Accordion, Table, NumberInput, Badge } from '@mantine/core'
import type { PricingConfig, ModelPricing, ModelOption } from '../../electron/store/types'

type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai'

interface PricingSettingsProps {
  modelsByProvider: Record<string, ModelOption[]>
  providerValid: Record<string, boolean>
  pricingConfig: PricingConfig | null
  defaultPricingConfig: PricingConfig | null
  onResetAll: () => void
  onResetProvider: (provider: ProviderName) => void
  onSetPrice: (provider: ProviderName, model: string, pricing: ModelPricing) => void
}

export default function PricingSettings({
  modelsByProvider,
  providerValid,
  pricingConfig,
  defaultPricingConfig,
  onResetAll,
  onResetProvider,
  onSetPrice,
}: PricingSettingsProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const hasCustomRates = Boolean(pricingConfig?.customRates)

  const getPricingFor = (provider: ProviderName) =>
    ((pricingConfig?.[provider] as Record<string, ModelPricing>) || {})

  const getDefaultPricingFor = (provider: ProviderName) =>
    ((defaultPricingConfig?.[provider] as Record<string, ModelPricing>) || {})

  const getModelsFor = (provider: ProviderName) => modelsByProvider[provider] || []

  return (
    <Card withBorder style={{ backgroundColor: '#1e1e1e', borderColor: '#3e3e42' }}>
      <Stack gap="md">
        <Group justify="space-between">
          <div>
            <Text size="sm" fw={600} c="#cccccc">Cost Estimation</Text>
            <Text size="xs" c="dimmed">
              Configure pricing per model for cost tracking
              {hasCustomRates && (
                <Badge size="xs" color="blue" ml="xs">Custom Rates</Badge>
              )}
            </Text>
          </div>
          <Button
            size="xs"
            variant="light"
            color="red"
            onClick={onResetAll}
            disabled={!hasCustomRates}
          >
            Reset All to Defaults
          </Button>
        </Group>

        <Accordion
          value={expanded}
          onChange={setExpanded}
          styles={{
            item: {
              backgroundColor: '#252526',
              border: '1px solid #3e3e42',
              marginBottom: '8px',
            },
            control: {
              color: '#cccccc',
              '&:hover': {
                backgroundColor: '#2d2d30',
              },
            },
            content: {
              padding: '12px',
            },
          }}
        >
          <PricingSection
            value="openai"
            label="OpenAI Models"
            models={getModelsFor('openai')}
            pricing={getPricingFor('openai')}
            defaultPricing={getDefaultPricingFor('openai')}
            onReset={() => onResetProvider('openai')}
            onUpdate={(model, pricing) => onSetPrice('openai', model, pricing)}
          />

          <PricingSection
            value="anthropic"
            label="Anthropic Models"
            models={getModelsFor('anthropic')}
            pricing={getPricingFor('anthropic')}
            defaultPricing={getDefaultPricingFor('anthropic')}
            onReset={() => onResetProvider('anthropic')}
            onUpdate={(model, pricing) => onSetPrice('anthropic', model, pricing)}
          />

          <PricingSection
            value="gemini"
            label="Google Gemini Models"
            models={getModelsFor('gemini')}
            pricing={getPricingFor('gemini')}
            defaultPricing={getDefaultPricingFor('gemini')}
            onReset={() => onResetProvider('gemini')}
            onUpdate={(model, pricing) => onSetPrice('gemini', model, pricing)}
          />

          {providerValid.fireworks && (
            <PricingSection
              value="fireworks"
              label="Fireworks Models"
              models={getModelsFor('fireworks')}
              pricing={getPricingFor('fireworks')}
              defaultPricing={getDefaultPricingFor('fireworks')}
              onReset={() => onResetProvider('fireworks')}
              onUpdate={(model, pricing) => onSetPrice('fireworks', model, pricing)}
            />
          )}

          <PricingSection
            value="xai"
            label="xAI Models"
            models={getModelsFor('xai')}
            pricing={getPricingFor('xai')}
            defaultPricing={getDefaultPricingFor('xai')}
            onReset={() => onResetProvider('xai')}
            onUpdate={(model, pricing) => onSetPrice('xai', model, pricing)}
          />
        </Accordion>

        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            💡 Pricing is per 1 million tokens. Costs are estimates based on published rates.
            Contact your provider for enterprise pricing.
          </Text>
          <Text size="xs" c="dimmed">
            💾 <strong>Cached Input</strong> pricing applies to Gemini models with context caching enabled.
            Cached tokens are typically charged at 75% discount (e.g., $0.075/1M vs $0.30/1M for Flash).
          </Text>
        </Stack>
      </Stack>
    </Card>
  )
}

interface PricingSectionProps {
  value: string
  label: string
  models: ModelOption[]
  pricing: Record<string, ModelPricing>
  defaultPricing: Record<string, ModelPricing>
  onReset: () => void
  onUpdate: (model: string, pricing: ModelPricing) => void
}

function PricingSection({ value, label, models, pricing, defaultPricing, onReset, onUpdate }: PricingSectionProps) {
  // Merge models from provider API with models that have pricing config
  const pricingKeys = Object.keys(pricing || {})
  const defaultPricingKeys = Object.keys(defaultPricing || {})
  const allPricedIds = new Set([...pricingKeys, ...defaultPricingKeys])

  const knownModelIds = new Set(models.map((m) => m.value))

  const additionalModels = Array.from(allPricedIds)
    .filter((id) => !knownModelIds.has(id))
    .map((id) => ({ value: id, label: id }))

  const allModels = [...models, ...additionalModels].sort((a, b) => a.label.localeCompare(b.label))

  return (
    <Accordion.Item value={value}>
      <Accordion.Control>
        <Group justify="space-between" style={{ width: '100%', paddingRight: '16px' }}>
          <Text size="sm" c="#cccccc">{label}</Text>
          <Text
            size="xs"
            c="dimmed"
            style={{ cursor: 'pointer', textDecoration: 'underline' }}
            onClick={(e) => {
              e.stopPropagation()
              onReset()
            }}
          >
            Reset
          </Text>
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        <PricingTable
          models={allModels}
          pricing={pricing}
          defaultPricing={defaultPricing}
          onUpdate={onUpdate}
        />
      </Accordion.Panel>
    </Accordion.Item>
  )
}

type PricingTableProps = {
  models: ModelOption[]
  pricing: Record<string, ModelPricing>
  defaultPricing: Record<string, ModelPricing>
  onUpdate: (model: string, pricing: ModelPricing) => void
}

function PricingTable({ models, pricing, defaultPricing, onUpdate }: PricingTableProps) {
  if (models.length === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center" py="md">
        No models available. Add an API key for this provider to see available models.
      </Text>
    )
  }

  return (
    <Table
      styles={{
        table: {
          backgroundColor: '#1e1e1e',
        },
        th: {
          color: '#cccccc',
          backgroundColor: '#252526',
          borderBottom: '1px solid #3e3e42',
        },
        td: {
          color: '#cccccc',
          borderBottom: '1px solid #3e3e42',
        },
      }}
    >
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Model</Table.Th>
          <Table.Th>Input ($/1M)</Table.Th>
          <Table.Th>Cached Input ($/1M)</Table.Th>
          <Table.Th>Output ($/1M)</Table.Th>
          <Table.Th></Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {models.map((model) => {
          const modelPricing = pricing[model.value] || { inputCostPer1M: 0, outputCostPer1M: 0 }
          const modelDefaultPricing = defaultPricing[model.value]

          const isDefault = modelDefaultPricing
            ? (modelPricing.inputCostPer1M === modelDefaultPricing.inputCostPer1M &&
              modelPricing.outputCostPer1M === modelDefaultPricing.outputCostPer1M &&
              modelPricing.cachedInputCostPer1M === modelDefaultPricing.cachedInputCostPer1M)
            : (modelPricing.inputCostPer1M === 0 && modelPricing.outputCostPer1M === 0)

          const supportsCaching = modelDefaultPricing?.cachedInputCostPer1M !== undefined

          return (
            <Table.Tr key={model.value}>
              <Table.Td>
                <Text size="xs" c="#cccccc">{model.label}</Text>
              </Table.Td>
              <Table.Td>
                <NumberInput
                  size="xs"
                  value={modelPricing.inputCostPer1M}
                  onChange={(val) => onUpdate(model.value, {
                    ...modelPricing,
                    inputCostPer1M: typeof val === 'number' ? val : 0,
                  })}
                  decimalScale={3}
                  step={0.1}
                  min={0}
                  prefix="$"
                  styles={{
                    input: {
                      backgroundColor: '#252526',
                      border: '1px solid #3e3e42',
                      color: '#cccccc',
                    },
                  }}
                />
              </Table.Td>
              <Table.Td>
                {supportsCaching ? (
                  <NumberInput
                    size="xs"
                    value={modelPricing.cachedInputCostPer1M ?? 0}
                    onChange={(val) => onUpdate(model.value, {
                      ...modelPricing,
                      cachedInputCostPer1M: typeof val === 'number' ? val : 0,
                    })}
                    decimalScale={4}
                    step={0.01}
                    min={0}
                    prefix="$"
                    styles={{
                      input: {
                        backgroundColor: '#252526',
                        border: '1px solid #3e3e42',
                        color: '#cccccc',
                      },
                    }}
                  />
                ) : (
                  <Text size="xs" c="dimmed" ta="center">—</Text>
                )}
              </Table.Td>
              <Table.Td>
                <NumberInput
                  size="xs"
                  value={modelPricing.outputCostPer1M}
                  onChange={(val) => onUpdate(model.value, {
                    ...modelPricing,
                    outputCostPer1M: typeof val === 'number' ? val : 0,
                  })}
                  decimalScale={3}
                  step={0.1}
                  min={0}
                  prefix="$"
                  styles={{
                    input: {
                      backgroundColor: '#252526',
                      border: '1px solid #3e3e42',
                      color: '#cccccc',
                    },
                  }}
                />
              </Table.Td>
              <Table.Td>
                {!isDefault && <Badge size="xs" color="blue">Custom</Badge>}
              </Table.Td>
            </Table.Tr>
          )
        })}
      </Table.Tbody>
    </Table>
  )
}
