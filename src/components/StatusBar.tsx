import { useMemo } from 'react'
import { Group, Text, UnstyledButton, Select } from '@mantine/core'
import { IconFolder, IconChevronDown } from '@tabler/icons-react'
import { useAppStore, useDispatch, selectWorkspaceRoot, selectSelectedModel, selectSelectedProvider, selectProviderValid, selectAgentMetrics, selectCurrentView } from '../store'
import { useRerenderTrace } from '../utils/perf'

const STATUS_BAR_HEIGHT = 24

export default function StatusBar() {
  // Use dispatch for actions
  const dispatch = useDispatch()

  // Use selectors for better performance
  const workspaceRoot = useAppStore(selectWorkspaceRoot)
  const selectedModel = useAppStore(selectSelectedModel)
  const selectedProvider = useAppStore(selectSelectedProvider)
  const providerValid = useAppStore(selectProviderValid)
  const agentMetrics = useAppStore(selectAgentMetrics)
  const currentView = useAppStore(selectCurrentView)

  // Flow Editor specific state - subscribe to primitives only to avoid ref churn
  // Guard against initial zubridge hydration where these arrays may be undefined
  const nodesCount = useAppStore((s) => (s.feNodes?.length ?? 0))
  const edgesCount = useAppStore((s) => (s.feEdges?.length ?? 0))
  const feStatus = useAppStore((s) => s.feStatus)

  // Perf: trace rerenders without passing large objects
  useRerenderTrace('StatusBar', {
    currentView,
    provider: selectedProvider,
    model: selectedModel,
    feStatus,
    nodes: nodesCount,
    edges: edgesCount,
  })


  const providerOptions = useMemo(() => {
    const all = [
      { value: 'openai', label: 'OpenAI' },
      { value: 'anthropic', label: 'Anthropic' },
      { value: 'gemini', label: 'Gemini' },
      { value: 'fireworks', label: 'Fireworks' },
      { value: 'xai', label: 'xAI' },
    ] as const
    const anyValidated = Object.values(providerValid || {}).some(Boolean)
    return anyValidated ? all.filter((p) => (providerValid as any)[p.value]) : all
  }, [providerValid])

  // Subscribe to only the current provider's models, with shallow comparator to avoid ref churn
  const modelOptions = useAppStore((s) => s.modelsByProvider[selectedProvider] || [])

  // For Fireworks, show only the last path segment as the label to keep it readable
  const displayModelOptions = useMemo(() => {
    const opts = modelOptions || []
    if (selectedProvider !== 'fireworks') return opts
    return opts.map((o: any) => {
      const last = (o.label || o.value || '').toString().split('/').pop() || o.label || o.value
      return { ...o, label: last }
    })
  }, [modelOptions, selectedProvider])

  const handleFolderClick = async () => {
    const result = await window.workspace?.openFolderDialog?.()
    if (result?.ok && result.path) {
      await dispatch('openFolder', result.path)
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

      {/* Right side - Combined status for agent view */}
      <Group gap={8}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 8px', height: STATUS_BAR_HEIGHT }}>
          {currentView === 'agent' ? (
            // Agent view: Show flow stats + provider/model selectors
            <>
              {/* Flow stats */}
              <Text size="xs" style={{ color: '#fff', opacity: 0.9 }}>
                {nodesCount} nodes · {edgesCount} edges
              </Text>
              {feStatus !== 'stopped' && (
                <>
                  <Text size="xs" c="dimmed" style={{ margin: '0 4px' }}>|</Text>
                  <Text size="xs" style={{
                    color: feStatus === 'waitingForInput' ? '#f59f00' : '#4caf50',
                    fontWeight: 600
                  }}>
                    {feStatus === 'waitingForInput' ? '⏸ WAITING' : '▶ RUNNING'}
                  </Text>
                </>
              )}

              {/* Agent metrics */}
              {agentMetrics && (
                <>
                  <Text size="xs" c="dimmed" style={{ margin: '0 4px' }}>|</Text>
                  <Text size="xs" style={{ color: '#fff', opacity: 0.9 }}>
                    {`Tokens ${agentMetrics.tokensUsed}/${agentMetrics.tokenBudget} (${agentMetrics.percentageUsed}%) · Iters ${agentMetrics.iterationsUsed}/${agentMetrics.maxIterations}`}
                  </Text>
                </>
              )}

              {/* Provider/Model selectors */}
              <Text size="xs" c="dimmed" style={{ margin: '0 4px' }}>|</Text>
              <Select
                value={providerOptions.find((p) => p.value === selectedProvider) ? selectedProvider : undefined}
                onChange={(v) => v && dispatch('setSelectedProvider', v)}
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
                onChange={(v) => v && dispatch('setSelectedModel', v)}
                data={displayModelOptions as any}
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
            </>
          ) : (
            // Other views: Show provider/model selectors only
            <>
              {/* Agent metrics compact display */}
              {agentMetrics && (
                <Text size="xs" style={{ color: '#fff', opacity: 0.9 }}>
                  {`Tokens ${agentMetrics.tokensUsed}/${agentMetrics.tokenBudget} (${agentMetrics.percentageUsed}%) · Iters ${agentMetrics.iterationsUsed}/${agentMetrics.maxIterations}`}
                </Text>
              )}
              <Select
                value={providerOptions.find((p) => p.value === selectedProvider) ? selectedProvider : undefined}
                onChange={(v) => v && dispatch('setSelectedProvider', v)}
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
                onChange={(v) => v && dispatch('setSelectedModel', v)}
                data={displayModelOptions as any}
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
            </>
          )}
        </div>
      </Group>
    </Group>
  )
}

