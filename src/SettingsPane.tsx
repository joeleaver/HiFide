import { useAppStore, useDispatch, selectModelsByProvider, selectProviderValid, selectDefaultModels, selectAutoRetry, selectAutoApproveEnabled, selectAutoApproveThreshold, selectSettingsApiKeys, selectSettingsSaving, selectSettingsSaved, selectStartupMessage } from './store'
import { Button, Group, Stack, Text, TextInput, Title, Select, Switch, Slider, Progress, Divider, Card, Alert, NumberInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import PricingSettings from './components/PricingSettings'
import { useEffect, useState } from 'react'

export default function SettingsPane() {
  // Use selectors for better performance
  const modelsByProvider = useAppStore(selectModelsByProvider)
  const providerValid = useAppStore(selectProviderValid)
  const defaultModels = useAppStore(selectDefaultModels)
  const autoRetry = useAppStore(selectAutoRetry)
  const autoApproveEnabled = useAppStore(selectAutoApproveEnabled)
  const autoApproveThreshold = useAppStore(selectAutoApproveThreshold)
  const settingsApiKeys = useAppStore(selectSettingsApiKeys)
  const settingsSaving = useAppStore(selectSettingsSaving)
  const settingsSaved = useAppStore(selectSettingsSaved)
  const settingsSaveResult = useAppStore((s) => s.settingsSaveResult)
  const settingsValidateResult = useAppStore((s) => s.settingsValidateResult)
  const startupMessage = useAppStore(selectStartupMessage)

  // Use dispatch to call actions
  const dispatch = useDispatch()

  // Use local state for API keys to avoid IPC calls on every keystroke
  const [localApiKeys, setLocalApiKeys] = useState(settingsApiKeys)

  // Sync local state when store changes (e.g., on load)
  useEffect(() => {
    setLocalApiKeys(settingsApiKeys)
  }, [settingsApiKeys])

  const openaiOptions = modelsByProvider.openai || []
  const anthropicOptions = modelsByProvider.anthropic || []
  const geminiOptions = modelsByProvider.gemini || []

  // Debug logging


  // Indexing state (centralized)
  const idxStatus = useAppStore((s) => s.idxStatus)
  const idxLoading = useAppStore((s) => s.idxLoading)
  const idxQuery = useAppStore((s) => s.idxQuery ?? '')
  const idxResults = useAppStore((s) => s.idxResults ?? [])
  const idxProg = useAppStore((s) => s.idxProg)

  // Index auto-refresh configuration
  const idxAutoRefresh = useAppStore((s) => s.idxAutoRefresh)
  const idxLastRebuildAt = useAppStore((s) => s.idxLastRebuildAt)


  // Use local state for index query to avoid IPC calls on every keystroke
  const [localIdxQuery, setLocalIdxQuery] = useState(idxQuery)

  // Sync local state when store changes
  useEffect(() => {
    setLocalIdxQuery(idxQuery)
  }, [idxQuery])

  // Refresh index status on mount and ensure progress subscription from main store
  useEffect(() => {
    dispatch('ensureIndexProgressSubscription')
    void dispatch('refreshIndexStatus')
  }, [dispatch])

  // Handle save/validate results reactively
  useEffect(() => {
    if (!settingsSaveResult) return

    if (!settingsSaveResult.ok) {
      notifications.show({
        color: 'red',
        title: 'Save failed',
        message: settingsSaveResult.failures.join(' | ') || 'Failed to save API keys'
      })
      return
    }

    // Save succeeded, check validation result
    if (!settingsValidateResult) return

    if (settingsValidateResult.ok) {
      notifications.show({
        color: 'teal',
        title: 'API keys saved',
        message: 'Settings have been saved and validated successfully.'
      })
    } else {
      const failures = settingsValidateResult.failures || []
      notifications.show({
        color: 'orange',
        title: 'Some keys failed validation',
        message: failures.join(' | ') || 'Unknown error'
      })
    }
  }, [settingsSaveResult, settingsValidateResult])


  const doRebuildIndex = async () => {
    const res = await dispatch('rebuildIndex')
    if (res?.ok) {
      notifications.show({ color: 'teal', title: 'Index rebuilt', message: `Chunks: ${res?.status?.chunks ?? 0}` })
    } else if (res?.error) {
      notifications.show({ color: 'red', title: 'Index rebuild failed', message: String(res.error) })
    }
  }

  const doClearIndex = async () => { try { await dispatch('clearIndex') } catch {} }

  const doSearchIndex = async () => {
    try {
      // Update store with local query before searching
      dispatch('setIdxQuery', localIdxQuery)
      await dispatch('searchIndex')
    } catch {}
  }



  const save = async () => {
    try {
      // Clear previous results
      dispatch('clearSettingsResults')

      // Update store with local API keys
      if (localApiKeys.openai !== settingsApiKeys.openai) {
        dispatch('setOpenAiApiKey', localApiKeys.openai)
      }
      if (localApiKeys.anthropic !== settingsApiKeys.anthropic) {
        dispatch('setAnthropicApiKey', localApiKeys.anthropic)
      }
      if (localApiKeys.gemini !== settingsApiKeys.gemini) {
        dispatch('setGeminiApiKey', localApiKeys.gemini)
      }

      // First save (marks as saved, auto-persisted via Zustand middleware)
      await dispatch('saveSettingsApiKeys')

      // Then validate the keys
      await dispatch('validateApiKeys')

      // Results will be available in state via settingsSaveResult and settingsValidateResult
      // The useEffect below will handle showing notifications
    } catch (e: any) {
      console.error('[SettingsPane] Save error:', e)
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
            value={localApiKeys.openai || ''}
            onChange={(e) => setLocalApiKeys({ ...localApiKeys, openai: e.currentTarget.value })}
            rightSection={providerValid.openai ? <Text size="xs" c="teal">✓</Text> : null}
          />
          <TextInput
            label="Anthropic API Key"
            placeholder="sk-ant-..."
            type="password"
            value={localApiKeys.anthropic || ''}
            onChange={(e) => setLocalApiKeys({ ...localApiKeys, anthropic: e.currentTarget.value })}
            rightSection={providerValid.anthropic ? <Text size="xs" c="teal">✓</Text> : null}
          />
          <TextInput
            label="Gemini API Key"
            placeholder="AIza..."
            type="password"
            value={localApiKeys.gemini || ''}
            onChange={(e) => setLocalApiKeys({ ...localApiKeys, gemini: e.currentTarget.value })}
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
            onChange={(v) => v && dispatch('setDefaultModel', { provider: 'openai', model: v })}
            disabled={!providerValid.openai || openaiOptions.length === 0}
            description={!providerValid.openai ? 'Add an OpenAI API key first' : openaiOptions.length === 0 ? 'Loading models...' : undefined}
          />
          <Select
            label="Anthropic Default Model"
            placeholder="Select a model..."
            data={anthropicOptions}
            value={defaultModels?.anthropic || null}
            onChange={(v) => v && dispatch('setDefaultModel', { provider: 'anthropic', model: v })}
            disabled={!providerValid.anthropic || anthropicOptions.length === 0}
            description={!providerValid.anthropic ? 'Add an Anthropic API key first' : anthropicOptions.length === 0 ? 'Loading models...' : undefined}
          />
          <Select
            label="Gemini Default Model"
            placeholder="Select a model..."
            data={geminiOptions}
            value={defaultModels?.gemini || null}
            onChange={(v) => v && dispatch('setDefaultModel', { provider: 'gemini', model: v })}
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
            onChange={(e) => dispatch('setAutoRetry', e.currentTarget.checked)}
          />

          <Switch
            label="Auto-approve risky commands"
            description="Allow agent to execute risky commands without confirmation when confidence is high"
            checked={autoApproveEnabled}
            onChange={(e) => dispatch('setAutoApproveEnabled', e.currentTarget.checked)}
          />

          {autoApproveEnabled && (
            <Stack gap={4}>
              <Text size="sm" fw={500}>Auto-approve confidence threshold: {autoApproveThreshold.toFixed(2)}</Text>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={autoApproveThreshold}
                onChange={(v) => dispatch('setAutoApproveThreshold', v)}
                marks={[
                  { value: 0, label: '0' },
                  { value: 0.5, label: '0.5' },
                  { value: 1, label: '1' },
                ]}
              />
              <Text size="xs" c="dimmed">Commands with confidence above this threshold will be auto-approved</Text>
            </Stack>
          )}
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
                  Last auto-refresh: {idxLastRebuildAt ? new Date(idxLastRebuildAt).toLocaleString() : '—'}
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
                  <Button variant="light" color="orange" onClick={() => dispatch('cancelIndexing')} size="sm">
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


        {/* Auto-maintenance (Semantic Index) */}
        <Card withBorder p="sm">
          <Stack gap="sm">
            <div>
              <Text size="sm" fw={600}>Semantic Index Auto-Refresh</Text>
              <Text size="xs" c="dimmed">Keep the semantic index fresh based on workspace activity. Rebuilds run in the background and do not block search.</Text>
            </div>

            <Switch
              label="Enable auto-refresh"
              checked={!!idxAutoRefresh?.enabled}
              onChange={(e) => dispatch('setIndexAutoRefresh', { config: { enabled: e.currentTarget.checked } })}
            />

            <Group grow>
              <NumberInput
                label="TTL (minutes)"
                description="Rebuild if index is older than this"
                min={5}
                max={1440}
                step={5}
                value={idxAutoRefresh?.ttlMinutes ?? 120}
                onChange={(v) => typeof v === 'number' && dispatch('setIndexAutoRefresh', { config: { ttlMinutes: Math.max(5, Math.min(1440, v)) } })}
              />
              <NumberInput
                label="Min interval (minutes)"
                description="Backoff between rebuilds to avoid thrash"
                min={1}
                max={120}
                step={1}
                value={idxAutoRefresh?.minIntervalMinutes ?? 10}
                onChange={(v) => typeof v === 'number' && dispatch('setIndexAutoRefresh', { config: { minIntervalMinutes: Math.max(1, Math.min(120, v)) } })}
              />
            </Group>

            <Group grow>
              <NumberInput
                label="File change threshold (absolute)"
                description="Rebuild when this many files change"
                min={0}
                step={10}
                value={idxAutoRefresh?.changeAbsoluteThreshold ?? 100}
                onChange={(v) => typeof v === 'number' && dispatch('setIndexAutoRefresh', { config: { changeAbsoluteThreshold: Math.max(0, v) } })}
              />
              <NumberInput
                label="File change threshold (%)"
                description="Rebuild when this fraction of files changes"
                min={0}
                max={1}
                step={0.01}
                
                value={idxAutoRefresh?.changePercentThreshold ?? 0.02}
                onChange={(v) => typeof v === 'number' && dispatch('setIndexAutoRefresh', { config: { changePercentThreshold: Math.max(0, Math.min(1, v)) } })}
              />
            </Group>

            <Switch
              label="Trigger on lockfile changes"
              description="Rebuild when package lockfiles change"
              checked={!!idxAutoRefresh?.lockfileTrigger}
              onChange={(e) => dispatch('setIndexAutoRefresh', { config: { lockfileTrigger: e.currentTarget.checked } })}
            />
            <TextInput
              label="Lockfile globs"
              description="Comma-separated list"
              value={(idxAutoRefresh?.lockfileGlobs || []).join(', ')}
              onChange={(e) => {
                const arr = e.currentTarget.value.split(',').map(s => s.trim()).filter(Boolean)
                dispatch('setIndexAutoRefresh', { config: { lockfileGlobs: arr } })
              }}
              placeholder="pnpm-lock.yaml, package-lock.json, yarn.lock"
            />

            <Group grow>
              <Switch
                label="Trigger on embedding model change"
                checked={!!idxAutoRefresh?.modelChangeTrigger}
                onChange={(e) => dispatch('setIndexAutoRefresh', { config: { modelChangeTrigger: e.currentTarget.checked } })}
              />
              <NumberInput
                label="Max rebuilds per hour"
                min={0}
                max={12}
                step={1}
                value={idxAutoRefresh?.maxRebuildsPerHour ?? 3}
                onChange={(v) => typeof v === 'number' && dispatch('setIndexAutoRefresh', { config: { maxRebuildsPerHour: Math.max(0, Math.min(12, v)) } })}
              />
            </Group>
          </Stack>
        </Card>

        <Stack gap="sm">
          <Text size="sm" fw={500}>Test Search</Text>
          <Group align="flex-end">
            <TextInput
              style={{ flex: 1 }}
              placeholder="e.g. where do we validate provider keys?"
              value={localIdxQuery}
              onChange={(e) => setLocalIdxQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  doSearchIndex()
                }
              }}
            />
            <Button onClick={doSearchIndex} size="sm">Search</Button>
          </Group>
          {idxResults.length > 0 && (
            <Stack gap={4}>
              <Text size="xs" c="dimmed" fw={500}>Results ({idxResults.length}):</Text>
              {idxResults.slice(0, 20).map((r: any, i: number) => (
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

