import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Center, Divider, Group, Loader, Select, Stack, Text, TextInput, Title, NavLink, Box, ScrollArea, Badge } from '@mantine/core'
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

type FireworksRpcResponse = FireworksUpdatePayload & { ok: boolean }
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

  const applyOpenRouterState = (payload?: FireworksUpdatePayload | null) => {
    if (!payload || !snapshot) return
    mergeSnapshot((prev) => ({
      ...prev,
      openrouterAllowedModels: Array.isArray(payload.fireworksAllowedModels)
        ? payload.fireworksAllowedModels
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
      const res = await client.rpc<FireworksRpcResponse>('provider.addOpenRouterModel', { model: value })
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
      const res = await client.rpc<FireworksRpcResponse>('provider.removeOpenRouterModel', { model })
      applyOpenRouterState(res)
    } catch (err) {
      notifications.show({ color: 'red', title: 'Error', message: String(err) })
    }
  }

  const loadOpenRouterDefaults = async () => {
    const client = getBackendClient()
    if (!client) return
    try {
      const res = await client.rpc<FireworksRpcResponse>('provider.openrouter.loadDefaults', {})
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
  const fireworksOptions = modelsByProvider.fireworks || []
  const openrouterAllowed = snapshot.openrouterAllowedModels || []
  const openrouterOptions = modelsByProvider.openrouter || []
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

function VectorSettingsSection() {
  const {
    state,
    error,
    searching,
    results,
    searchQuery,
    searchTarget,
    fetchState,
    subscribe,
    setSearchQuery,
    setSearchTarget,
    search,
    startIndexing
  } = useVectorStore()

  useEffect(() => {
    fetchState()
    return subscribe()
  }, [fetchState, subscribe])

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

  return (
    <Stack gap="md">
      <Box>
        <Title order={3}>Vector Search & Indexing</Title>
        <Text size="sm" c="dimmed">Manage semantic search database and indexing status</Text>
      </Box>

      <Stack gap="sm">
        <Title order={4}>Semantic Search</Title>
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
                      <Badge size="xs" color={res.type === 'code' ? 'blue' : 'green'}>{res.type}</Badge>
                      <Text size="xs" fw={700} c="dimmed">Score: {(1 - res.score).toFixed(4)}</Text>
                    </Group>
                    <Text size="xs" c="dimmed">{res.filePath || res.metadata?.path || 'N/A'}</Text>
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
      </Stack>

      <Divider mt="md" />

      <Stack gap="sm" p="md" style={{ backgroundColor: '#252526', borderRadius: 4 }}>
        <Group justify="space-between">
          <Text size="sm" fw={500}>Indexing Status</Text>
          <Group gap="xs">
            {state.status.indexing && <Loader size={14} />}
            <Text size="sm" c={state.status.indexing ? 'blue' : 'dimmed'}>
              {state.status.indexing ? 'Indexing in progress...' : 'Idle'}
            </Text>
          </Group>
        </Group>

        <Divider color="#3e3e42" />

        <Group justify="space-between">
          <Stack gap={4}>
            <Text size="xs" c="dimmed">Progress</Text>
            <Text size="sm">{state.status.progress}% ({state.status.indexedFiles} / {state.status.totalFiles} files)</Text>
          </Stack>
          <Button size="xs" variant="light" onClick={startIndexing} loading={state.status.indexing}>
            Re-index All
          </Button>
        </Group>

        {state.lastIndexedAt && (
          <Text size="xs" c="dimmed">Last indexed: {new Date(state.lastIndexedAt).toLocaleString()}</Text>
        )}
      </Stack>

      <Stack gap="xs">
        <Title order={4}>Configuration</Title>
        <Group grow>
          <TextInput label="Embedding Model" value="all-MiniLM-L6-v2 (Local)" disabled />
          <TextInput label="Storage" value="LanceDB (Local)" disabled />
        </Group>
      </Stack>
    </Stack>
  )
}
