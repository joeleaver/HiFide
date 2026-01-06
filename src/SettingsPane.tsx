import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Center, Divider, Group, Loader, Select, Stack, Text, TextInput, Title, NavLink, Box, ScrollArea, Badge, Paper, Switch } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconKey, IconRobot, IconCash, IconDatabase } from '@tabler/icons-react'
import { getBackendClient } from './lib/backend/bootstrap'
import PricingSettings from './components/PricingSettings'
import { ApiKeysSection } from './components/ApiKeysSection'
import { useSettingsSnapshot } from './hooks/useSettingsSnapshot'
import type { ModelOption } from '../electron/store/types'
import { useSettingsPricingDraft } from './store/settingsPricingDraft'

type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai' | 'openrouter'

type FireworksUpdatePayload = {
  fireworksAllowedModels?: string[]
  models?: ModelOption[]
}

type OpenRouterUpdatePayload = {
  openrouterAllowedModels?: string[]
  models?: ModelOption[]
}

type FireworksRpcResponse = FireworksUpdatePayload & { ok: boolean }
type OpenRouterRpcResponse = OpenRouterUpdatePayload & { ok: boolean }
type RefreshModelsResponse = { ok: boolean; models?: ModelOption[] }

export default function SettingsPane() {
  const { snapshot, error, refresh, mergeSnapshot } = useSettingsSnapshot()
  const syncPricingDraft = useSettingsPricingDraft((state) => state.syncFromSnapshot)
  const persistPricingDraft = useSettingsPricingDraft((state) => state.persistDraft)
  const discardPricingDraft = useSettingsPricingDraft((state) => state.discardDraft)
  const pricingSaving = useSettingsPricingDraft((state) => state.saving)
  const pricingDirty = useSettingsPricingDraft(
    (state) => state.dirtyProviders.length > 0 || state.pendingResetAll || state.pendingProviderResets.length > 0
  )

  const [newFwModel, setNewFwModel] = useState('')
  const [newOrModel, setNewOrModel] = useState('')
  const [activeTab, setActiveTab] = useState('api-keys')

  useEffect(() => {
    if (snapshot) {
      syncPricingDraft(snapshot.pricingConfig, snapshot.defaultPricingConfig)
    }
  }, [snapshot?.pricingConfig, snapshot?.defaultPricingConfig, syncPricingDraft])

  const handleSavePricingDraft = useCallback(async () => {
    const nextConfig = await persistPricingDraft()
    if (nextConfig) {
      mergeSnapshot({ pricingConfig: nextConfig })
    }
  }, [persistPricingDraft, mergeSnapshot])

  const updateDefaultModel = async (provider: ProviderName, value: string | null) => {
    if (!value) return
    const client = getBackendClient()
    if (!client) return
    try {
      await client.rpc('provider.setDefaultModel', { provider, model: value })
      mergeSnapshot((prev) => ({
        ...prev,
        defaultModels: {
          ...prev.defaultModels,
          [provider]: value,
        },
      }))
    } catch (err) {
      notifications.show({ color: 'red', title: 'Error', message: String(err) })
    }
  }

  const applyFireworksState = (payload?: FireworksUpdatePayload | null) => {
    if (!payload) return
    mergeSnapshot((prev) => ({
      ...prev,
      fireworksAllowedModels: Array.isArray(payload.fireworksAllowedModels)
        ? payload.fireworksAllowedModels
        : prev.fireworksAllowedModels,
      modelsByProvider: {
        ...prev.modelsByProvider,
        fireworks: Array.isArray(payload.models) ? payload.models : prev.modelsByProvider.fireworks,
      },
    }))
  }

  const applyOpenRouterState = (payload?: OpenRouterUpdatePayload | null) => {
    if (!payload || !snapshot) return
    mergeSnapshot((prev) => ({
      ...prev,
      openrouterAllowedModels: Array.isArray(payload.openrouterAllowedModels)
        ? payload.openrouterAllowedModels
        : prev.openrouterAllowedModels,
      modelsByProvider: {
        ...prev.modelsByProvider,
        openrouter: Array.isArray(payload.models) ? payload.models : prev.modelsByProvider.openrouter,
      },
    }))
  }

  const handleKeysSaveComplete = useCallback(async () => {
    await refresh()
  }, [refresh])

  const addFireworksModel = async () => {
    const value = newFwModel.trim()
    if (!value) return
    const client = getBackendClient()
    if (!client) return
    try {
      const res = await client.rpc<FireworksRpcResponse>('provider.addFireworksModel', { model: value })
      applyFireworksState(res)
      setNewFwModel('')
    } catch (err) {
      notifications.show({ color: 'red', title: 'Error', message: String(err) })
    }
  }

  const removeFireworksModel = async (model: string) => {
    const client = getBackendClient()
    if (!client) return
    try {
      const res = await client.rpc<FireworksRpcResponse>('provider.removeFireworksModel', { model })
      applyFireworksState(res)
    } catch (err) {
      notifications.show({ color: 'red', title: 'Error', message: String(err) })
    }
  }

  const loadFireworksDefaults = async () => {
    const client = getBackendClient()
    if (!client) return
    try {
      const res = await client.rpc<FireworksRpcResponse>('provider.fireworks.loadDefaults', {})
      applyFireworksState(res)
    } catch (err) {
      notifications.show({ color: 'red', title: 'Error', message: String(err) })
    }
  }

  const refreshFireworksModels = async () => {
    const client = getBackendClient()
    if (!client) return
    try {
      const res = await client.rpc<RefreshModelsResponse>('provider.refreshModels', { provider: 'fireworks' })
      if (res?.ok) {
        mergeSnapshot((prev) => ({
          ...prev,
          modelsByProvider: {
            ...prev.modelsByProvider,
            fireworks: Array.isArray(res.models) ? res.models : prev.modelsByProvider.fireworks,
          },
        }))
      }
    } catch (err) {
      notifications.show({ color: 'red', title: 'Error', message: String(err) })
    }
  }

  const addOpenRouterModel = async () => {
    const value = newOrModel.trim()
    if (!value) return
    const client = getBackendClient()
    if (!client) return
    try {
      const res = await client.rpc<OpenRouterRpcResponse>('provider.addOpenRouterModel', { model: value })
      applyOpenRouterState(res)
      setNewOrModel('')
    } catch (err) {
      notifications.show({ color: 'red', title: 'Error', message: String(err) })
    }
  }

  const removeOpenRouterModel = async (model: string) => {
    const client = getBackendClient()
    if (!client) return
    try {
      const res = await client.rpc<OpenRouterRpcResponse>('provider.removeOpenRouterModel', { model })
      applyOpenRouterState(res)
    } catch (err) {
      notifications.show({ color: 'red', title: 'Error', message: String(err) })
    }
  }

  const loadOpenRouterDefaults = async () => {
    const client = getBackendClient()
    if (!client) return
    try {
      const res = await client.rpc<OpenRouterRpcResponse>('provider.openrouter.loadDefaults', {})
      applyOpenRouterState(res)
    } catch (err) {
      notifications.show({ color: 'red', title: 'Error', message: String(err) })
    }
  }

  const refreshOpenRouterModels = async () => {
    const client = getBackendClient()
    if (!client) return
    try {
      const res = await client.rpc<RefreshModelsResponse>('provider.refreshModels', { provider: 'openrouter' })
      if (res?.ok) {
        mergeSnapshot((prev) => ({
          ...prev,
          modelsByProvider: {
            ...prev.modelsByProvider,
            openrouter: Array.isArray(res.models) ? res.models : prev.modelsByProvider.openrouter,
          },
        }))
      }
    } catch (err) {
      notifications.show({ color: 'red', title: 'Error', message: String(err) })
    }
  }

  console.log('[SettingsPane] Render', { snapshot: !!snapshot, error, activeTab })

  if (!snapshot) {
    return (
      <Center style={{ width: '100%', height: '100%' }}>
        <Stack gap="sm" align="center">
          <Loader size="sm" color="gray" />
          <Text size="sm" c="dimmed">{error ? `Failed to load settings: ${error}` : 'Loading settings…'}</Text>
          {error && <Text size="xs" c="red">{error}</Text>}
          <Button variant="subtle" size="xs" onClick={() => refresh()}>Retry</Button>
        </Stack>
      </Center>
    )
  }

  const providerState = snapshot.providerValid
  const modelsByProvider = snapshot.modelsByProvider
  const defaultModels = snapshot.defaultModels
  const startupMessage = snapshot.startupMessage
  const fireworksAllowed = snapshot.fireworksAllowedModels || []
  const fireworksOptions = (modelsByProvider.fireworks || []).map((m) => ({ value: m.value, label: m.label }))

  const openrouterAllowed = snapshot.openrouterAllowedModels || []
  const openrouterOptions = (modelsByProvider.openrouter || []).map((m) => ({ value: m.value, label: m.label }))

  const xaiOptions = modelsByProvider.xai || []

  return (
    <Group h="100%" gap={0} align="stretch" wrap="nowrap">
      <Box w={240} style={{ borderRight: '1px solid #3e3e42', backgroundColor: '#1e1e1e' }} p="xs">
        <Stack gap="xs">
          <Title order={5} px="xs" py="xs" c="dimmed">Settings</Title>
          <NavLink component="div" label="API Keys" leftSection={<IconKey size={16} />} active={activeTab === 'api-keys'} onClick={() => setActiveTab('api-keys')} variant="light" styles={{ label: { fontWeight: activeTab === 'api-keys' ? 600 : 400 } }} />
          <NavLink component="div" label="Default Models" leftSection={<IconRobot size={16} />} active={activeTab === 'models'} onClick={() => setActiveTab('models')} variant="light" styles={{ label: { fontWeight: activeTab === 'models' ? 600 : 400 } }} />
          <NavLink component="div" label="Cost & Pricing" leftSection={<IconCash size={16} />} active={activeTab === 'pricing'} onClick={() => setActiveTab('pricing')} variant="light" styles={{ label: { fontWeight: activeTab === 'pricing' ? 600 : 400 } }} />
          <NavLink component="div" label="Vector Search" leftSection={<IconDatabase size={16} />} active={activeTab === 'vector'} onClick={() => setActiveTab('vector')} variant="light" styles={{ label: { fontWeight: activeTab === 'vector' ? 600 : 400 } }} />
        </Stack>
      </Box>

      <ScrollArea style={{ flex: 1 }} p="xl">
        <Stack gap="xl" maw={900}>
          {startupMessage && <Alert color="yellow" title="Configuration Required">{startupMessage}</Alert>}
          {error && <Alert color="red" title="Settings Error">{error}</Alert>}

          {activeTab === 'api-keys' && (
            <Stack gap="md">
              <Box>
                <Title order={3}>API Keys</Title>
                <Box mt={4}><Text size="sm" c="dimmed">Configure provider API keys (persisted locally via Electron Store)</Text></Box>
              </Box>
              <ApiKeysSection initialApiKeys={snapshot.settingsApiKeys} initialProviderValid={snapshot.providerValid} onSaveComplete={handleKeysSaveComplete}>
                {providerState.fireworks && (
                  <>
                    <Divider />
                    <Stack gap="xs">
                      <Title order={4}>Fireworks Models</Title>
                      <Group align="flex-end">
                        <TextInput style={{ flex: 1 }} label="Add model by ID" placeholder="ID..." value={newFwModel} onChange={(e) => setNewFwModel(e.currentTarget.value)} />
                        <Button onClick={addFireworksModel} disabled={!newFwModel.trim()}>Add</Button>
                        <Button variant="light" onClick={loadFireworksDefaults}>Defaults</Button>
                        <Button variant="light" onClick={refreshFireworksModels}>Refresh</Button>
                      </Group>
                      <Stack gap={4}>
                        {fireworksAllowed.length === 0 ? <Text size="xs" c="dimmed">No models.</Text> : fireworksAllowed.map((m) => (
                          <Group key={m} justify="space-between" wrap="nowrap">
                            <Text size="xs" c="#ccc" truncate>{m}</Text>
                            <Button size="xs" variant="light" color="red" onClick={() => removeFireworksModel(m)}>Remove</Button>
                          </Group>
                        ))}
                      </Stack>
                    </Stack>
                  </>
                )}
                {providerState.openrouter && (
                  <>
                    <Divider />
                    <Stack gap="xs">
                      <Title order={4}>OpenRouter Models</Title>
                      <Group align="flex-end">
                        <TextInput style={{ flex: 1 }} label="Add model by ID" placeholder="ID..." value={newOrModel} onChange={(e) => setNewOrModel(e.currentTarget.value)} />
                        <Button onClick={addOpenRouterModel} disabled={!newOrModel.trim()}>Add</Button>
                        <Button variant="light" onClick={loadOpenRouterDefaults}>Defaults</Button>
                        <Button variant="light" onClick={refreshOpenRouterModels}>Refresh</Button>
                      </Group>
                      <Stack gap={4}>
                        {openrouterAllowed.length === 0 ? <Text size="xs" c="dimmed">No models.</Text> : openrouterAllowed.map((m) => (
                          <Group key={m} justify="space-between" wrap="nowrap">
                            <Text size="xs" c="#ccc" truncate>{m}</Text>
                            <Button size="xs" variant="light" color="red" onClick={() => removeOpenRouterModel(m)}>Remove</Button>
                          </Group>
                        ))}
                      </Stack>
                    </Stack>
                  </>
                )}
              </ApiKeysSection>
            </Stack>
          )}

          {activeTab === 'models' && (
            <Stack gap="md">
              <Box><Title order={3}>Default Models</Title></Box>
              <Stack gap="sm">
                <ProviderSelect label="OpenAI" options={modelsByProvider.openai || []} value={defaultModels.openai || null} disabled={!providerState.openai} onChange={(value: string) => updateDefaultModel('openai', value)} />
                <ProviderSelect label="Anthropic" options={modelsByProvider.anthropic || []} value={defaultModels.anthropic || null} disabled={!providerState.anthropic} onChange={(value: string) => updateDefaultModel('anthropic', value)} />
                <ProviderSelect label="Gemini" options={modelsByProvider.gemini || []} value={defaultModels.gemini || null} disabled={!providerState.gemini} onChange={(value: string) => updateDefaultModel('gemini', value)} />
                {providerState.fireworks && <ProviderSelect label="Fireworks" options={fireworksOptions} value={defaultModels.fireworks || null} disabled={fireworksOptions.length === 0} onChange={(value: string) => updateDefaultModel('fireworks', value)} />}
                {providerState.openrouter && <ProviderSelect label="OpenRouter" options={openrouterOptions} value={defaultModels.openrouter || null} disabled={openrouterOptions.length === 0} onChange={(value: string) => updateDefaultModel('openrouter', value)} />}
                <ProviderSelect label="xAI" options={xaiOptions} value={defaultModels.xai || null} disabled={!providerState.xai} onChange={(value: string) => updateDefaultModel('xai', value)} />
              </Stack>
            </Stack>
          )}

          {activeTab === 'pricing' && (
            <Stack gap="md">
              <Box><Title order={3}>Cost Estimation</Title></Box>
              <PricingSettings modelsByProvider={modelsByProvider} providerValid={providerState} />
              <Group justify="space-between">
                <Button variant="subtle" color="gray" onClick={discardPricingDraft} disabled={!pricingDirty}>Discard</Button>
                <Button onClick={handleSavePricingDraft} loading={pricingSaving} disabled={!pricingDirty}>Save Changes</Button>
              </Group>
            </Stack>
          )}

          {activeTab === 'vector' && <VectorSettingsSection />}
        </Stack>
      </ScrollArea>
    </Group>
  )
}

function ProviderSelect({ label, options, value, disabled, onChange }: any) {
  return <Select label={label} placeholder="Select a model..." data={options} value={value} onChange={onChange} disabled={disabled} />
}

import { useVectorStore } from './store/vectorStore'
import { useIndexingStore } from './store/indexingStore'
import { IconCode, IconBook, IconBrain, IconSearch } from '@tabler/icons-react'

function VectorSettingsSection() {
  const { snapshot, mergeSnapshot } = useSettingsSnapshot()
  const {
    state,
    error,
    searching,
    results,
    searchQuery,
    searchTarget,
    init,
    fetchState,
    setSearchQuery,
    setSearchTarget,
    search,
    startIndexing
  } = useVectorStore()

  const indexingStatus = useIndexingStore((s) => s.status)
  const indexingLoading = useIndexingStore((s) => s.loading)
  const setIndexingEnabled = useIndexingStore((s) => s.setEnabled)

  const settings = (snapshot as any)?.vector || {}
  const indexingWorkers = settings.indexingWorkers || 4

  const handleIndexingWorkersChange = useCallback(async (value: number) => {
    const update = { ...settings, indexingWorkers: value }

    // Update both the snapshot and the backend
    mergeSnapshot((prev: any) => ({
      ...prev,
      vector: update
    }))

    try {
      const client = getBackendClient()
      if (client) {
        await client.rpc('settings.setVectorSettings', { vector: update })
        console.log('[VectorSettingsSection] Updated indexingWorkers to', value)
      }
    } catch (err) {
      console.error('[VectorSettingsSection] Failed to update indexingWorkers:', err)
      notifications.show({
        color: 'red',
        title: 'Error',
        message: 'Failed to update indexing workers setting'
      })
    }
  }, [settings, mergeSnapshot])

  const handleToggleEnabled = useCallback((checked: boolean) => {
    setIndexingEnabled(checked)
  }, [setIndexingEnabled])

  // Initialize store on first access (idempotent)
  init()

  const vectorStatus = state ? (state.status as any) : null
  const indexingEnabled = indexingStatus?.indexingEnabled ?? true

  // Early returns for loading/error states - placed AFTER all hooks
  if (error) {
    return (
      <Alert color="red" title="Vector Service Error">
        {error}
        <Button size="xs" variant="light" mt="sm" onClick={fetchState}>Try Again</Button>
      </Alert>
    )
  }

  if (!state) {
    return (
      <Stack align="center" py="xl">
        <Loader size="sm" />
        <Text size="xs" c="dimmed">Loading vector service state...</Text>
      </Stack>
    )
  }

  const TableCard = ({ title, tableKey, icon: Icon, color }: any) => {
    const tableState = (state.status.tables as any)?.[tableKey]

    // Get indexing counts from indexingStatus (from orchestrator)
    const indexingCounts = indexingStatus?.[tableKey as keyof typeof indexingStatus] as { total: number; indexed: number; missing: number } | undefined

    // Check both global activeTable and individual source progress
    const tableSource = vectorStatus?.sources?.[tableKey]
    const hasRemainingWork = tableSource && tableSource.indexed < tableSource.total
    const isIndexingThisTable = (vectorStatus?.activeTable === tableKey || vectorStatus?.activeTable === 'all') && (hasRemainingWork || vectorStatus?.indexing)

    // Calculate progress specific to this table if available
    const tableProgress = tableSource && tableSource.total > 0
      ? Math.floor((tableSource.indexed / tableSource.total) * 100)
      : 0

    return (
      <Box p="md" style={{ backgroundColor: '#252526', borderRadius: 8, border: '1px solid #333', flex: 1 }}>
        <Stack gap="sm">
          <Group justify="space-between" wrap="nowrap">
            <Group gap="xs">
              <Icon size={18} color={color} />
              <Text size="sm" fw={600}>{title}</Text>
            </Group>
            {tableState?.exists && (
              <Badge variant="light" color={color} size="sm">{tableState.count} vectors</Badge>
            )}
          </Group>

          {/* Status: indexed / total counts */}
          {indexingCounts && (
            <Group justify="space-between" gap="xs">
              <Text size="xs" c="dimmed">Indexed</Text>
              <Group gap="xs">
                <Text size="xs" fw={500}>{indexingCounts.indexed} / {indexingCounts.total}</Text>
                {indexingCounts.missing > 0 && (
                  <Badge size="xs" color="yellow" variant="light">{indexingCounts.missing} pending</Badge>
                )}
              </Group>
            </Group>
          )}

          <Select
            label="Embedding Model"
            size="xs"
            data={[
              'all-MiniLM-L6-v2 (Local)',
              'nomic-embed-text-v1.5 (Local)',
              'code-rank-embed (Local)'  // Code-specific embeddings
            ]}
            value={settings?.[`${tableKey}Model`] || settings?.model || 'all-MiniLM-L6-v2 (Local)'}
            onChange={(val) => {
              if (val) {
                const update: any = {};
                update[`${tableKey}Model`] = val;
                useVectorStore.getState().updateVectorSettings(update)
                // Also update the local snapshot to avoid jitter
                mergeSnapshot((prev: any) => ({
                  ...prev,
                  vector: { ...prev.vector, ...update }
                }))
              }
            }}
          />

          <Button
            size="xs"
            variant="light"
            fullWidth
            onClick={() => startIndexing(tableKey)}
            loading={isIndexingThisTable}
            leftSection={<IconSearch size={14} />}
          >
            Re-index
          </Button>

          {isIndexingThisTable && (
            <Stack gap={2}>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">Syncing...</Text>
                <Text size="xs" fw={500}>{tableProgress}%</Text>
              </Group>
              <Box h={4} style={{ backgroundColor: '#1a1a1a', borderRadius: 2, overflow: 'hidden' }}>
                <Box h="100%" w={`${tableProgress}%`} style={{ backgroundColor: color, transition: 'width 0.3s ease' }} />
              </Box>
              {tableSource && (
                <Text size="10px" c="dimmed" ta="right">
                  {tableSource.indexed} / {tableSource.total} files
                </Text>
              )}
            </Stack>
          )}

          {tableState?.indexedAt && !isIndexingThisTable && (
            <Text size="xs" c="dimmed" fs="italic">
              Updated: {new Date(tableState.indexedAt).toLocaleDateString()}
            </Text>
          )}
        </Stack>
      </Box>
    )
  }

  return (
    <Stack gap="xl">
      {/* Header with Enable Toggle */}
      <Group justify="space-between" align="flex-start">
        <Box>
          <Title order={3}>Vector Search & Indexing</Title>
          <Text size="sm" c="dimmed">Semantic database management for Code, Knowledge Base and Memories</Text>
        </Box>
        <Switch
          label="Indexing"
          labelPosition="left"
          checked={indexingEnabled}
          onChange={(e) => handleToggleEnabled(e.currentTarget.checked)}
          disabled={indexingLoading}
          size="md"
          styles={{
            label: { fontWeight: 500 }
          }}
        />
      </Group>

      {/* Processing status banner - only show when indexing is enabled */}
      {indexingEnabled && indexingStatus?.isProcessing && (
        <Paper p="xs" withBorder style={{ borderColor: '#3a6ea5', backgroundColor: '#1a2a3a' }}>
          <Group gap="sm">
            <Loader size="xs" color="blue" />
            <Text size="sm">
              Processing queue ({indexingStatus.queueLength || 0} items remaining)
            </Text>
          </Group>
        </Paper>
      )}

      {/* Three-column table cards with status integrated */}
      <Group align="stretch" grow wrap="wrap">
        <TableCard title="Codebase" tableKey="code" icon={IconCode} color="#228be6" />
        <TableCard title="Knowledge Base" tableKey="kb" icon={IconBook} color="#40c057" />
        <TableCard title="Memories" tableKey="memories" icon={IconBrain} color="#fd7e14" />
      </Group>

      <Divider />

      {/* Indexing Performance */}
      <Stack gap="sm">
        <Title order={4}>Indexing Performance</Title>
        <Group align="flex-end" gap="md">
          <Box style={{ flex: 1 }}>
            <Text size="sm" mb={4}>Concurrent Workers</Text>
            <Group gap="xs">
              {[1, 2, 4, 8, 16].map((n) => (
                <Button
                  key={n}
                  size="xs"
                  variant={indexingWorkers === n ? 'filled' : 'light'}
                  onClick={() => handleIndexingWorkersChange(n)}
                >
                  {n}
                </Button>
              ))}
            </Group>
          </Box>
          <Text size="xs" c="dimmed" style={{ maxWidth: 400 }}>
            Number of concurrent worker threads for file indexing. Higher values may improve performance on multi-core systems but use more memory.
          </Text>
        </Group>
        <Text size="xs" c="blue">
          Current: {indexingWorkers} worker{indexingWorkers !== 1 ? 's' : ''}
        </Text>
      </Stack>

      <Divider />

      <Stack gap="sm">
        <Title order={4}>Semantic Search</Title>
        {!indexingEnabled ? (
          <Text size="sm" c="dimmed">
            Semantic search is disabled because indexing is turned off. Enable indexing above to use semantic search.
          </Text>
        ) : (
          <>
            <Group align="flex-end">
              <TextInput
                placeholder="Search for something (e.g. 'how to handle errors' or 'VectorService init')..."
                style={{ flex: 1 }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && search()}
              />
              <Select
                data={[
                  { value: 'all', label: 'All' },
                  { value: 'code', label: 'Code' },
                  { value: 'kb', label: 'Knowledge Base' },
                  { value: 'memories', label: 'Memories' },
                ]}
                value={searchTarget}
                onChange={(val) => setSearchTarget(val as any)}
                w={160}
              />
              <Button onClick={search} loading={searching}>Search</Button>
            </Group>

            {results.length > 0 && (
              <ScrollArea h={400} offsetScrollbars>
                <Stack gap="xs" p="xs" style={{ backgroundColor: '#1e1e1e', borderRadius: 4 }}>
                  {results.map((res, i) => (
                    <Box
                      key={i}
                      p="xs"
                      style={{
                        border: '1px solid #333',
                        borderRadius: 4,
                        backgroundColor: '#252526'
                      }}
                    >
                      <Group justify="space-between" mb={4}>
                        <Group gap="xs">
                          <Badge size="xs" color={res.type === 'code' ? 'blue' : (res.type === 'kb' ? 'green' : 'gray')}>{res.type}</Badge>
                          <Text size="xs" fw={700} c="dimmed">Similarity: {Math.max(0, res.score * 100).toFixed(1)}%</Text>
                        </Group>
                        <Text size="xs" c="dimmed" truncate style={{ maxWidth: 300 }}>{res.filePath || 'N/A'}</Text>
                      </Group>
                      <Text size="sm" fw={600} mb={4}>{res.symbolName || res.articleTitle || 'Snippet'}</Text>
                      <Box
                        p="xs"
                        style={{
                          backgroundColor: '#1a1a1a',
                          borderRadius: 4,
                          borderLeft: '2px solid #3e3e42'
                        }}
                      >
                        <Text size="xs" style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }} lineClamp={6}>
                          {res.text}
                        </Text>
                      </Box>
                    </Box>
                  ))}
                </Stack>
              </ScrollArea>
            )}
          </>
        )}
      </Stack>
    </Stack>
  )
}
