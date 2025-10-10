import { useEffect, useMemo } from 'react'
import { Group, Text, UnstyledButton, Select } from '@mantine/core'
import { IconFolder, IconChevronDown } from '@tabler/icons-react'
import { useAppStore } from '../store/app'

const STATUS_BAR_HEIGHT = 24

export default function StatusBar() {
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const openFolder = useAppStore((s) => s.openFolder)
  const selectedModel = useAppStore((s) => s.selectedModel)
  const setSelectedModel = useAppStore((s) => s.setSelectedModel)
  const selectedProvider = useAppStore((s) => s.selectedProvider)
  const setSelectedProvider = useAppStore((s) => s.setSelectedProvider)
  const providerValid = useAppStore((s) => s.providerValid)

  // Centralized indexing actions
  const ensureIndexProgressSubscription = useAppStore((s) => s.ensureIndexProgressSubscription)

  const providerOptions = useMemo(() => {
    const all = [
      { value: 'openai', label: 'OpenAI' },
      { value: 'anthropic', label: 'Anthropic' },
      { value: 'gemini', label: 'Gemini' },
    ] as const
    const anyValidated = Object.values(providerValid || {}).some(Boolean)
    return anyValidated ? all.filter((p) => providerValid[p.value]) : all
  }, [providerValid])

  // Agent metrics subscription + state
  const ensureAgentMetricsSubscription = useAppStore((s) => s.ensureAgentMetricsSubscription)
  const agentMetrics = useAppStore((s) => s.agentMetrics)
  useEffect(() => { try { ensureAgentMetricsSubscription() } catch {} }, [ensureAgentMetricsSubscription])
  const ensureProviderModelConsistency = useAppStore((s) => s.ensureProviderModelConsistency)

  const defaultModels = useAppStore((s) => s.defaultModels)

  // Models come from centralized store (no direct window.models calls here)
  const modelsByProvider = useAppStore((s) => s.modelsByProvider)
  const modelOptions = useMemo(() => modelsByProvider[selectedProvider] || [], [modelsByProvider, selectedProvider])

  // Keep provider/model consistent using centralized store logic
  useEffect(() => { try { ensureProviderModelConsistency() } catch {} }, [providerValid, modelsByProvider, selectedProvider, selectedModel, defaultModels])

  // Ensure index progress subscription is active (StatusBar is always mounted)
  useEffect(() => {
    try { ensureIndexProgressSubscription() } catch {}
  }, [ensureIndexProgressSubscription])

  const handleFolderClick = async () => {
    const result = await window.workspace?.openFolderDialog?.()
    if (result?.ok && result.path) {
      await openFolder(result.path)
    }
  }

  return (
    <Group
      gap={0}
      style={{
        height: STATUS_BAR_HEIGHT,
        backgroundColor: '#007acc',
        color: '#ffffff',
        fontSize: '12px',
        padding: '0 8px',
        borderTop: '1px solid #005a9e',
        flexShrink: 0,
        width: '100%',
      }}
      justify="space-between"
    >
      {/* Left side - Folder */}
      <Group gap={8}>
        <UnstyledButton
          onClick={handleFolderClick}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '0 8px',
            height: STATUS_BAR_HEIGHT,
            color: '#ffffff',
            cursor: 'pointer',
            transition: 'background-color 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <IconFolder size={14} stroke={2} />
          <Text size="xs" style={{ fontWeight: 500 }}>
            {workspaceRoot ? workspaceRoot.split('\\').pop() || workspaceRoot : 'No Folder Open'}
          </Text>
        </UnstyledButton>
      </Group>

      {/* Right side - Metrics + Provider + Model selectors */}
      <Group gap={8}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 8px', height: STATUS_BAR_HEIGHT }}>
          {/* Agent metrics compact display */}
          {agentMetrics && (
            <Text size="xs" style={{ color: '#fff', opacity: 0.9 }}>
              {`Tokens ${agentMetrics.tokensUsed}/${agentMetrics.tokenBudget} (${agentMetrics.percentageUsed}%)} · Iters ${agentMetrics.iterationsUsed}/${agentMetrics.maxIterations}`}
            </Text>
          )}
          <Select
            value={providerOptions.find((p) => p.value === selectedProvider) ? selectedProvider : undefined}
            onChange={(v) => v && setSelectedProvider(v)}
            data={providerOptions as any}
            size="xs"
            variant="unstyled"
            placeholder={providerOptions.length ? 'Select provider' : 'No validated providers'}
            disabled={providerOptions.length === 0}
            rightSection={<IconChevronDown size={12} />}
            styles={{
              input: { color: '#fff', fontSize: 12, fontWeight: 500, padding: 0, minHeight: 'auto', height: STATUS_BAR_HEIGHT, border: 'none', cursor: providerOptions.length ? 'pointer' : 'not-allowed' },
              section: { color: '#fff' },
            }}
            comboboxProps={{ position: 'top', offset: 4 }}
          />
          <Text size="xs" c="dimmed" style={{ margin: '0 4px' }}>|</Text>
          <Select
            value={selectedModel}
            onChange={(v) => v && setSelectedModel(v)}
            data={modelOptions}
            size="xs"
            variant="unstyled"
            disabled={providerOptions.length === 0}
            rightSection={<IconChevronDown size={12} />}
            styles={{
              input: { color: '#fff', fontSize: 12, fontWeight: 500, padding: 0, minHeight: 'auto', height: STATUS_BAR_HEIGHT, border: 'none', cursor: providerOptions.length ? 'pointer' : 'not-allowed' },
              section: { color: '#fff' },
            }}
            comboboxProps={{ position: 'top', offset: 4 }}
          />
        </div>
      </Group>
    </Group>
  )
}

