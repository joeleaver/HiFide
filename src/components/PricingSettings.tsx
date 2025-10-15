import { useState } from 'react'
import { Card, Stack, Group, Text, Button, Accordion, Table, NumberInput, Badge } from '@mantine/core'
import { useAppStore, selectModelsByProvider, selectPricingConfig } from '../store'
import { DEFAULT_PRICING, type ModelPricing } from '../data/defaultPricing'

export default function PricingSettings() {
  // Use selectors for better performance
  const modelsByProvider = useAppStore(selectModelsByProvider)
  const pricingConfig = useAppStore(selectPricingConfig)

  // Actions only - these don't cause re-renders
  const setPricingForModel = useAppStore((s) => s.setPricingForModel)
  const resetPricingToDefaults = useAppStore((s) => s.resetPricingToDefaults)
  const resetProviderPricing = useAppStore((s) => s.resetProviderPricing)
  
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
            onClick={() => resetPricingToDefaults()}
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
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={(e) => {
                    e.stopPropagation()
                    resetProviderPricing('openai')
                  }}
                >
                  Reset
                </Button>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <PricingTable
                provider="openai"
                models={modelsByProvider.openai || []}
                pricing={pricingConfig.openai}
                onUpdate={(model, pricing) => setPricingForModel('openai', model, pricing)}
              />
            </Accordion.Panel>
          </Accordion.Item>
          
          {/* Anthropic */}
          <Accordion.Item value="anthropic">
            <Accordion.Control>
              <Group justify="space-between" style={{ width: '100%', paddingRight: '16px' }}>
                <Text size="sm" c="#cccccc">Anthropic Models</Text>
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={(e) => {
                    e.stopPropagation()
                    resetProviderPricing('anthropic')
                  }}
                >
                  Reset
                </Button>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <PricingTable
                provider="anthropic"
                models={modelsByProvider.anthropic || []}
                pricing={pricingConfig.anthropic}
                onUpdate={(model, pricing) => setPricingForModel('anthropic', model, pricing)}
              />
            </Accordion.Panel>
          </Accordion.Item>
          
          {/* Gemini */}
          <Accordion.Item value="gemini">
            <Accordion.Control>
              <Group justify="space-between" style={{ width: '100%', paddingRight: '16px' }}>
                <Text size="sm" c="#cccccc">Google Gemini Models</Text>
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={(e) => {
                    e.stopPropagation()
                    resetProviderPricing('gemini')
                  }}
                >
                  Reset
                </Button>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <PricingTable
                provider="gemini"
                models={modelsByProvider.gemini || []}
                pricing={pricingConfig.gemini}
                onUpdate={(model, pricing) => setPricingForModel('gemini', model, pricing)}
              />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
        
        <Text size="xs" c="dimmed">
          💡 Pricing is per 1 million tokens. Costs are estimates based on published rates.
          Contact your provider for enterprise pricing.
        </Text>
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
            modelPricing.outputCostPer1M === defaultPricing.outputCostPer1M

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

