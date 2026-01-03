import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Center, Divider, Group, Loader, Select, Stack, Switch, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
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

  const [newFwModel, setNewFwModel] = useState('')
  const [newOrModel, setNewOrModel] = useState('')


  if (!snapshot) {
    return (
      <Center style={{ width: '100%', height: '100%' }}>
        <Stack gap="sm" align="center">
          <Loader size="sm" color="gray" />
          <Text size="sm" c="dimmed">{error ? 'Failed to load settings snapshot.' : 'Loading settings…'}</Text>
          {error && <Text size="xs" c="red">{error}</Text>}
        </Stack>
      </Center>
    )
  }

  const providerState = snapshot.providerValid
  const modelsByProvider = snapshot.modelsByProvider
  const defaultModels = snapshot.defaultModels
  const autoRetry = snapshot.autoRetry
  const startupMessage = snapshot.startupMessage
  const fireworksAllowed = snapshot.fireworksAllowedModels || []
  const fireworksOptions = modelsByProvider.fireworks || []
  const openrouterAllowed = snapshot.openrouterAllowedModels || []
  const openrouterOptions = modelsByProvider.openrouter || []
  const xaiOptions = modelsByProvider.xai || []


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

  const updateAutoRetry = async (value: boolean) => {
    const client = getBackendClient()
    if (!client) return
    try {
      await client.rpc('provider.setAutoRetry', { value })
      mergeSnapshot({ autoRetry: value })
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
    if (!payload) return
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


  return (
    <Stack gap="xl" p="md">
      {startupMessage && (
        <Alert color="yellow" title="Configuration Required">
          {startupMessage}
        </Alert>
      )}

      {error && (
        <Alert color="red" title="Settings Error">
          {error}
        </Alert>
      )}

      <Stack gap="md">
        <div>
          <Title order={3}>API Keys</Title>
          <Text size="sm" c="dimmed">Configure provider API keys (persisted locally via Electron Store in the main process)</Text>
        </div>

        <ApiKeysSection
          initialApiKeys={snapshot.settingsApiKeys}
          initialProviderValid={snapshot.providerValid}
          onSaveComplete={refresh}
        >
          {providerState.fireworks && (
            <Stack gap="xs">
              <Title order={4}>Fireworks Models</Title>
              <Text size="sm" c="dimmed">Select which Fireworks models to expose in the app. Start with recommended defaults or add specific model IDs.</Text>

              <Group align="flex-end">
                <TextInput
                  style={{ flex: 1 }}
                  label="Add model by ID"
                  placeholder="e.g., accounts/fireworks/models/qwen3-coder-480b-a35b-instruct"
                  value={newFwModel}
                  onChange={(e) => setNewFwModel(e.currentTarget.value)}
                />
                <Button onClick={addFireworksModel} disabled={!newFwModel.trim()}>
                  Add
                </Button>
                <Button variant="light" onClick={loadFireworksDefaults}>
                  Load Recommended Defaults
                </Button>
                <Button variant="light" onClick={refreshFireworksModels}>
                  Refresh
                </Button>
              </Group>

              <Stack gap={4}>
                {fireworksAllowed.length === 0 ? (
                  <Text size="xs" c="dimmed">No allowed models yet.</Text>
                ) : (
                  fireworksAllowed.map((m) => (
                    <Group key={m} justify="space-between" wrap="nowrap">
                      <Text size="xs" c="#ccc" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</Text>
                      <Button size="xs" variant="light" color="red" onClick={() => removeFireworksModel(m)}>
                        Remove
                      </Button>
                    </Group>
                  ))
                )}
              </Stack>
            </Stack>
          )}
          {providerState.openrouter && (
            <Stack gap="xs">
              <Title order={4}>OpenRouter Models</Title>
              <Text size="sm" c="dimmed">Select which OpenRouter models to expose in the app. Start with recommended defaults or add specific model IDs.</Text>

              <Group align="flex-end">
                <TextInput
                  style={{ flex: 1 }}
                  label="Add model by ID"
                  placeholder="e.g., openrouter/meta-llama/llama-3.1-8b-instruct:free"
                  value={newOrModel}
                  onChange={(e) => setNewOrModel(e.currentTarget.value)}
                />
                <Button onClick={addOpenRouterModel} disabled={!newOrModel.trim()}>
                  Add
                </Button>
                <Button variant="light" onClick={loadOpenRouterDefaults}>
                  Load Recommended Defaults
                </Button>
                <Button variant="light" onClick={refreshOpenRouterModels}>
                  Refresh
                </Button>
              </Group>

              <Stack gap={4}>
                {openrouterAllowed.length === 0 ? (
                  <Text size="xs" c="dimmed">No allowed models yet.</Text>
                ) : (
                  openrouterAllowed.map((m) => (
                    <Group key={m} justify="space-between" wrap="nowrap">
                      <Text size="xs" c="#ccc" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</Text>
                      <Button size="xs" variant="light" color="red" onClick={() => removeOpenRouterModel(m)}>
                        Remove
                      </Button>
                    </Group>
                  ))
                )}
              </Stack>
            </Stack>
          )}
        </ApiKeysSection>
      </Stack>

      <Divider />

      <Stack gap="md">
        <div>
          <Title order={3}>Default Models</Title>
          <Text size="sm" c="dimmed">Choose default models for each provider (only available after adding API keys)</Text>
        </div>

        <Stack gap="sm">
          <ProviderSelect
            label="OpenAI Default Model"
            options={modelsByProvider.openai || []}
            value={defaultModels.openai || null}
            disabled={!providerState.openai || (modelsByProvider.openai || []).length === 0}
            disabledMessage={!providerState.openai ? 'Add an OpenAI API key first' : 'Loading models...'}
            onChange={(value) => updateDefaultModel('openai', value)}
          />
          <ProviderSelect
            label="Anthropic Default Model"
            options={modelsByProvider.anthropic || []}
            value={defaultModels.anthropic || null}
            disabled={!providerState.anthropic || (modelsByProvider.anthropic || []).length === 0}
            disabledMessage={!providerState.anthropic ? 'Add an Anthropic API key first' : 'Loading models...'}
            onChange={(value) => updateDefaultModel('anthropic', value)}
          />
          <ProviderSelect
            label="Gemini Default Model"
            options={modelsByProvider.gemini || []}
            value={defaultModels.gemini || null}
            disabled={!providerState.gemini || (modelsByProvider.gemini || []).length === 0}
            disabledMessage={!providerState.gemini ? 'Add a Gemini API key first' : 'Loading models...'}
            onChange={(value) => updateDefaultModel('gemini', value)}
          />
          {providerState.fireworks && (
            <ProviderSelect
              label="Fireworks Default Model"
              options={fireworksOptions}
              value={defaultModels.fireworks || null}
              disabled={fireworksOptions.length === 0}
              disabledMessage="Populate allowlist or refresh models"
              onChange={(value) => updateDefaultModel('fireworks', value)}
            />
          )}
          {providerState.openrouter && (
            <ProviderSelect
              label="OpenRouter Default Model"
              options={openrouterOptions}
              value={defaultModels.openrouter || null}
              disabled={openrouterOptions.length === 0}
              disabledMessage="Populate allowlist or refresh models"
              onChange={(value) => updateDefaultModel('openrouter', value)}
            />
          )}
          <ProviderSelect
            label="xAI Default Model"
            options={xaiOptions}
            value={defaultModels.xai || null}
            disabled={!providerState.xai || xaiOptions.length === 0}
            disabledMessage={!providerState.xai ? 'Add an xAI API key first' : 'Loading models...'}
            onChange={(value) => updateDefaultModel('xai', value)}
          />
        </Stack>
      </Stack>

      <Divider />

      <Stack gap="md">
        <div>
          <Title order={3}>Agent Behavior</Title>
          <Text size="sm" c="dimmed">Configure how the agent handles commands and code changes</Text>
        </div>

        <Stack gap="md">
          <Switch
            label="Auto-retry on stream errors"
            description="Automatically retry when streaming responses fail"
            checked={autoRetry}
            onChange={(e) => updateAutoRetry(e.currentTarget.checked)}
          />
        </Stack>
      </Stack>

      <Divider />

      <Stack gap="md">
        <div>
          <Title order={3}>Cost Estimation</Title>
          <Text size="sm" c="dimmed">Configure pricing per model for accurate cost tracking</Text>
        </div>
        <PricingSettings
          modelsByProvider={modelsByProvider}
          providerValid={providerState}
        />
        <Group justify="space-between">
          <Button variant="subtle" color="gray" onClick={discardPricingDraft} disabled={!pricingDirty}>
            Discard Pricing Draft
          </Button>
          <Button onClick={handleSavePricingDraft} loading={pricingSaving} disabled={!pricingDirty}>
            Save Pricing Changes
          </Button>
        </Group>
      </Stack>
    </Stack>
  )
}

interface ProviderSelectProps {
  label: string
  options: ModelOption[]
  value: string | null
  disabled: boolean
  disabledMessage?: string
  onChange: (value: string | null) => void
}

function ProviderSelect({ label, options, value, disabled, disabledMessage, onChange }: ProviderSelectProps) {
  return (
    <Select
      label={label}
      placeholder="Select a model..."
      data={options}
      value={value}
      onChange={onChange}
      disabled={disabled}
      description={disabled && disabledMessage ? disabledMessage : undefined}
    />
  )
}
