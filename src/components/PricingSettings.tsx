import { useState } from 'react'
import { Card, Stack, Group, Text, Button, Accordion, Table, NumberInput, Badge } from '@mantine/core'
import { useAppStore, useDispatch, selectModelsByProvider, selectPricingConfig } from '../store'
import { DEFAULT_PRICING, type ModelPricing } from '../data/defaultPricing'

export default function PricingSettings() {
  // Use selectors for better performance
  const modelsByProvider = useAppStore(selectModelsByProvider)
  const pricingConfig = useAppStore(selectPricingConfig)

  // Use dispatch for actions
  const dispatch = useDispatch()
  
  const [expanded, setExpanded] = useState<string | null>(null)
  
  return (
    <Card withBorder style={{ backgroundColor: '#1e1e1e', borderColor: '#3e3e42' }}>
      <Stack gap="md">
        <Group justify="space-between">
          <div>
            <Text size="sm" fw={600} c="#cccccc">Cost Estimation</Text>
            <Text size="xs" c="dimmed">
              Configure pricing per model for cost tracking
              {pricingConfig.customRates && (
                <Badge size="xs" color="blue" ml="xs">Custom Rates</Badge>
              )}
            </Text>
          </div>
          <Button
            size="xs"
            variant="light"
            color="red"
            onClick={() => dispatch('resetPricingToDefaults')}
            disabled={!pricingConfig.customRates}
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
          {/* OpenAI */}
          <Accordion.Item value="openai">
            <Accordion.Control>
              <Group justify="space-between" style={{ width: '100%', paddingRight: '16px' }}>
                <Text size="sm" c="#cccccc">OpenAI Models</Text>
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    dispatch('resetProviderPricing', 'openai')
                  }}
                >
                  Reset
                </Text>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <PricingTable
                provider="openai"
                models={modelsByProvider.openai || []}
                pricing={pricingConfig.openai}
                onUpdate={(model, pricing) => dispatch('setPricingForModel', { provider: 'openai', model, pricing })}
              />
            </Accordion.Panel>
          </Accordion.Item>
          
          {/* Anthropic */}
          <Accordion.Item value="anthropic">
            <Accordion.Control>
              <Group justify="space-between" style={{ width: '100%', paddingRight: '16px' }}>
                <Text size="sm" c="#cccccc">Anthropic Models</Text>
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    dispatch('resetProviderPricing', 'anthropic')
                  }}
                >
                  Reset
                </Text>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <PricingTable
                provider="anthropic"
                models={modelsByProvider.anthropic || []}
                pricing={pricingConfig.anthropic}
                onUpdate={(model, pricing) => dispatch('setPricingForModel', { provider: 'anthropic', model, pricing })}
              />
            </Accordion.Panel>
          </Accordion.Item>
          
          {/* Gemini */}
          <Accordion.Item value="gemini">
            <Accordion.Control>
              <Group justify="space-between" style={{ width: '100%', paddingRight: '16px' }}>
                <Text size="sm" c="#cccccc">Google Gemini Models</Text>
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    dispatch('resetProviderPricing', 'gemini')
                  }}
                >
                  Reset
                </Text>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <PricingTable
                provider="gemini"
                models={modelsByProvider.gemini || []}
                pricing={pricingConfig.gemini}
                onUpdate={(model, pricing) => dispatch('setPricingForModel', { provider: 'gemini', model, pricing })}
              />
            </Accordion.Panel>
          </Accordion.Item>
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

type PricingTableProps = {
  provider: string
  models: Array<{ value: string; label: string }>
  pricing: Record<string, ModelPricing>
  onUpdate: (model: string, pricing: ModelPricing) => void
}

function PricingTable({ provider, models, pricing, onUpdate }: PricingTableProps) {
  // Only show models that have pricing configured in DEFAULT_PRICING
  const availableModels = models.filter(model => {
    const defaultPricing = (DEFAULT_PRICING as any)[provider]?.[model.value]
    return defaultPricing !== undefined
  })

  if (availableModels.length === 0) {
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
        {availableModels.map((model) => {
          const modelPricing = pricing[model.value] || { inputCostPer1M: 0, outputCostPer1M: 0 }
          const defaultPricing = (DEFAULT_PRICING as any)[provider]?.[model.value]
          const isDefault = defaultPricing &&
            modelPricing.inputCostPer1M === defaultPricing.inputCostPer1M &&
            modelPricing.outputCostPer1M === defaultPricing.outputCostPer1M &&
            modelPricing.cachedInputCostPer1M === defaultPricing.cachedInputCostPer1M

          // Check if this model supports caching (has cachedInputCostPer1M in defaults)
          const supportsCaching = defaultPricing?.cachedInputCostPer1M !== undefined

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
                    inputCostPer1M: typeof val === 'number' ? val : 0
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
                      cachedInputCostPer1M: typeof val === 'number' ? val : 0
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
                    outputCostPer1M: typeof val === 'number' ? val : 0
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
                {!isDefault && (
                  <Badge size="xs" color="blue">Custom</Badge>
                )}
              </Table.Td>
            </Table.Tr>
          )
        })}
      </Table.Tbody>
    </Table>
  )
}

