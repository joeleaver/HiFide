import { useEffect } from 'react'
import { Button, Group, Stack, Text, TextInput, Title, Select, Switch, Slider, Progress, Divider, Card, Alert } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useAppStore, selectModelsByProvider, selectProviderValid, selectDefaultModels, selectAutoRetry, selectAutoApproveEnabled, selectAutoApproveThreshold, selectAutoEnforceEditsSchema, selectSettingsApiKeys, selectSettingsSaving, selectSettingsSaved, selectStartupMessage } from './store'
import PricingSettings from './components/PricingSettings'

import RateLimitSettings from './components/RateLimitSettings'

export default function SettingsPane() {
  // Use selectors for better performance
  const modelsByProvider = useAppStore(selectModelsByProvider)
  const providerValid = useAppStore(selectProviderValid)
  const defaultModels = useAppStore(selectDefaultModels)
  const autoRetry = useAppStore(selectAutoRetry)
  const autoApproveEnabled = useAppStore(selectAutoApproveEnabled)
  const autoApproveThreshold = useAppStore(selectAutoApproveThreshold)
  const autoEnforceEditsSchema = useAppStore(selectAutoEnforceEditsSchema)
  const settingsApiKeys = useAppStore(selectSettingsApiKeys)
  const settingsSaving = useAppStore(selectSettingsSaving)
  const settingsSaved = useAppStore(selectSettingsSaved)
  const startupMessage = useAppStore(selectStartupMessage)

  // Actions only - these don't cause re-renders
  const setAutoRetry = useAppStore((s) => s.setAutoRetry)
  const setDefaultModel = useAppStore((s) => s.setDefaultModel)
  const setAutoApproveEnabled = useAppStore((s) => s.setAutoApproveEnabled)
  const setAutoApproveThreshold = useAppStore((s) => s.setAutoApproveThreshold)
  const setAutoEnforceEditsSchema = useAppStore((s) => s.setAutoEnforceEditsSchema)
  const setSettingsApiKey = useAppStore((s) => s.setSettingsApiKey)
  const loadSettingsApiKeys = useAppStore((s) => s.loadSettingsApiKeys)
  const saveSettingsApiKeys = useAppStore((s) => s.saveSettingsApiKeys)

  // Load keys on mount
  useEffect(() => {
    void loadSettingsApiKeys()
  }, [loadSettingsApiKeys])

  const openaiOptions = modelsByProvider.openai || []
  const anthropicOptions = modelsByProvider.anthropic || []
  const geminiOptions = modelsByProvider.gemini || []

  // Debug logging
  console.log('[SettingsPane] defaultModels:', defaultModels)
  console.log('[SettingsPane] geminiOptions:', geminiOptions)
  console.log('[SettingsPane] providerValid:', providerValid)


  // Indexing state (centralized)
  const {
    idxStatus, idxLoading, idxQuery, idxResults, idxProg,
    ensureIndexProgressSubscription, refreshIndexStatus, rebuildIndex,
    clearIndex, setIdxQuery, searchIndex
  } = useAppStore()

  useEffect(() => {
    ensureIndexProgressSubscription()
    void refreshIndexStatus()
  }, [])


  const doRebuildIndex = async () => {
    const res = await rebuildIndex()
    if (res?.ok) {
      notifications.show({ color: 'teal', title: 'Index rebuilt', message: `Chunks: ${res?.status?.chunks ?? 0}` })
    } else if (res?.error) {
      notifications.show({ color: 'red', title: 'Index rebuild failed', message: String(res.error) })
    }
  }

  const doClearIndex = async () => { try { await clearIndex() } catch {} }

  const doSearchIndex = async () => { try { await searchIndex() } catch {} }



  const save = async () => {
    try {
      const result = await saveSettingsApiKeys()

      if (result.ok) {
        notifications.show({ color: 'teal', title: 'API keys validated', message: 'All configured provider keys look good.' })
      } else {
        notifications.show({ color: 'orange', title: 'Some keys failed validation', message: result.failures.join(' | ') })
      }
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Save failed', message: e?.message || String(e) })
    }
  }


  return (
    <Stack gap="xl" p="md">
      {/* Startup Message Banner */}
      {startupMessage && (
        <Alert color="yellow" title="Configuration Required">
          {startupMessage}
        </Alert>
      )}

      {/* API Keys Section */}
      <Stack gap="md">
        <div>
          <Title order={3}>API Keys</Title>
          <Text size="sm" c="dimmed">Configure provider API keys (stored locally in browser localStorage)</Text>
        </div>

        <Stack gap="sm">
          <TextInput
            label="OpenAI API Key"
            placeholder="sk-..."
            type="password"
            value={settingsApiKeys.openai}
            onChange={(e) => setSettingsApiKey('openai', e.currentTarget.value)}
            rightSection={providerValid.openai ? <Text size="xs" c="teal">✓</Text> : null}
          />
          <TextInput
            label="Anthropic API Key"
            placeholder="sk-ant-..."
            type="password"
            value={settingsApiKeys.anthropic}
            onChange={(e) => setSettingsApiKey('anthropic', e.currentTarget.value)}
            rightSection={providerValid.anthropic ? <Text size="xs" c="teal">✓</Text> : null}
          />
          <TextInput
            label="Gemini API Key"
            placeholder="AIza..."
            type="password"
            value={settingsApiKeys.gemini}
            onChange={(e) => setSettingsApiKey('gemini', e.currentTarget.value)}
            rightSection={providerValid.gemini ? <Text size="xs" c="teal">✓</Text> : null}
          />
        </Stack>

        <Group>
          <Button onClick={save} loading={settingsSaving}>
            Save & Validate Keys
          </Button>
          {settingsSaved && <Text c="teal" size="sm">✓ Saved successfully</Text>}
        </Group>
      </Stack>

      <Divider />

      {/* Default Models Section */}
      <Stack gap="md">
        <div>
          <Title order={3}>Default Models</Title>
          <Text size="sm" c="dimmed">Choose default models for each provider (only available after adding API keys)</Text>
        </div>

        <Stack gap="sm">
          <Select
            label="OpenAI Default Model"
            placeholder="Select a model..."
            data={openaiOptions}
            value={defaultModels?.openai || null}
            onChange={(v) => v && setDefaultModel('openai', v)}
            disabled={!providerValid.openai || openaiOptions.length === 0}
            description={!providerValid.openai ? 'Add an OpenAI API key first' : openaiOptions.length === 0 ? 'Loading models...' : undefined}
          />
          <Select
            label="Anthropic Default Model"
            placeholder="Select a model..."
            data={anthropicOptions}
            value={defaultModels?.anthropic || null}
            onChange={(v) => v && setDefaultModel('anthropic', v)}
            disabled={!providerValid.anthropic || anthropicOptions.length === 0}
            description={!providerValid.anthropic ? 'Add an Anthropic API key first' : anthropicOptions.length === 0 ? 'Loading models...' : undefined}
          />
          <Select
            label="Gemini Default Model"
            placeholder="Select a model..."
            data={geminiOptions}
            value={defaultModels?.gemini || null}
            onChange={(v) => v && setDefaultModel('gemini', v)}
            disabled={!providerValid.gemini || geminiOptions.length === 0}
            description={!providerValid.gemini ? 'Add a Gemini API key first' : geminiOptions.length === 0 ? 'Loading models...' : undefined}
          />
        </Stack>
      </Stack>

      <Divider />

      {/* Agent Behavior Section */}
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
            onChange={(e) => setAutoRetry(e.currentTarget.checked)}
          />

          <Switch
            label="Auto-approve risky commands"
            description="Allow agent to execute risky commands without confirmation when confidence is high"
            checked={autoApproveEnabled}
            onChange={(e) => setAutoApproveEnabled(e.currentTarget.checked)}
          />

          {autoApproveEnabled && (
            <Stack gap={4}>
              <Text size="sm" fw={500}>Auto-approve confidence threshold: {autoApproveThreshold.toFixed(2)}</Text>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={autoApproveThreshold}
                onChange={setAutoApproveThreshold}
                marks={[
                  { value: 0, label: '0' },
                  { value: 0.5, label: '0.5' },
                  { value: 1, label: '1' },
                ]}
              />
              <Text size="xs" c="dimmed">Commands with confidence above this threshold will be auto-approved</Text>
            </Stack>
          )}

          <Switch
            label="Enforce structured edits schema"
            description="Require agent to use structured JSON format when proposing code changes"
            checked={autoEnforceEditsSchema}
            onChange={(e) => setAutoEnforceEditsSchema(e.currentTarget.checked)}
          />
        </Stack>
      </Stack>

      <Divider />

      {/* Cost Estimation Section */}
      <Stack gap="md">
        <div>
          <Title order={3}>Cost Estimation</Title>
          <Text size="sm" c="dimmed">Configure pricing per model for accurate cost tracking</Text>
        </div>
        <PricingSettings />
      </Stack>

      <Divider />

      {/* Rate Limits Section */}
      <Stack gap="md">
        <div>
          <Title order={3}>Rate Limits</Title>
          <Text size="sm" c="dimmed">Optionally throttle requests/tokens per model to avoid exceeding provider quotas</Text>
        </div>
        <RateLimitSettings />
      </Stack>

      <Divider />

      {/* Indexing Section */}
      <Stack gap="md">
        <div>
          <Title order={3}>Local Code Index</Title>
          <Text size="sm" c="dimmed">Build a local embeddings index for semantic code search (no cloud calls)</Text>
        </div>

        {idxStatus && (
          <Card withBorder p="sm">
            <Group justify="space-between">
              <Stack gap={4}>
                <Text size="sm" fw={500}>
                  Status: {idxStatus.ready ? '✓ Ready' : '⚠ Not Ready'}
                </Text>
                <Text size="xs" c="dimmed">
                  {idxStatus.chunks} chunks indexed • Model: {idxStatus.modelId || 'local'} • Dim: {idxStatus.dim || 384}
                </Text>
              </Stack>
              <Group>
                <Button onClick={doRebuildIndex} loading={idxLoading} size="sm">
                  Rebuild
                </Button>
                <Button variant="light" color="red" onClick={doClearIndex} size="sm">
                  Clear
                </Button>
                {idxProg?.inProgress && (
                  <Button variant="light" color="orange" onClick={() => window.indexing?.cancel?.()} size="sm">
                    Cancel
                  </Button>
                )}
              </Group>
            </Group>
          </Card>
        )}

        {idxProg && idxProg.inProgress && (
          <Stack gap={4}>
            <Progress value={(() => {
              const phase = idxProg.phase || 'idle'
              if (phase === 'scanning') {
                const t = idxProg.totalFiles || 0, p = idxProg.processedFiles || 0
                return t > 0 ? Math.min(80, Math.round((p / t) * 80)) : 5
              }
              if (phase === 'embedding') return 90
              if (phase === 'saving') return 95
              if (phase === 'done') return 100
              if (phase === 'cancelled') return 0
              return 0
            })()} />
            <Text size="xs" c="dimmed">
              {idxProg.phase || 'idle'} • Files: {idxProg.processedFiles ?? 0}/{idxProg.totalFiles ?? 0} • Chunks: {idxProg.processedChunks ?? 0}/{idxProg.totalChunks ?? 0} • {Math.round((idxProg.elapsedMs || 0)/1000)}s
            </Text>
          </Stack>
        )}

        <Stack gap="sm">
          <Text size="sm" fw={500}>Test Search</Text>
          <Group align="flex-end">
            <TextInput
              style={{ flex: 1 }}
              placeholder="e.g. where do we validate provider keys?"
              value={idxQuery}
              onChange={(e) => setIdxQuery(e.currentTarget.value)}
            />
            <Button onClick={doSearchIndex} size="sm">Search</Button>
          </Group>
          {idxResults.length > 0 && (
            <Stack gap={4}>
              <Text size="xs" c="dimmed" fw={500}>Results ({idxResults.length}):</Text>
              {idxResults.slice(0, 20).map((r, i) => (
                <Text key={i} size="xs" c="dimmed" ff="monospace">
                  {r.path}:{r.startLine}-{r.endLine}
                </Text>
              ))}
            </Stack>
          )}
        </Stack>
      </Stack>

    </Stack>
  )
}

