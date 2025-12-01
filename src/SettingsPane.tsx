import { getBackendClient } from './lib/backend/bootstrap'
import { Button, Group, Stack, Text, TextInput, Title, Select, Switch, Progress, Divider, Card, Alert, NumberInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import PricingSettings from './components/PricingSettings'
import { useEffect, useState } from 'react'
import { ApiKeysForm } from './components/ApiKeysForm'
import { useApiKeyManagement } from './hooks/useApiKeyManagement'

export default function SettingsPane() {
  // Use the reusable API key management hook
  const { apiKeys, setApiKeys, providerValid, saving, validating, saveAndValidate } = useApiKeyManagement(false)

  // Local UI state hydrated from backend snapshots
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, any>>({})
  const [defaultModels, setDefaultModels] = useState<Record<string, string>>({})
  const [autoRetry, setAutoRetry] = useState(false)
  const [startupMessage, setStartupMessage] = useState<string | null>(null)

  // Fireworks allowlist management
  const [newFwModel, setNewFwModel] = useState('')
  const [fireworksAllowed, setFireworksAllowed] = useState<string[]>([])

  const openaiOptions = (modelsByProvider as any).openai || []
  const anthropicOptions = (modelsByProvider as any).anthropic || []
  const geminiOptions = (modelsByProvider as any).gemini || []
  const fireworksOptions = (modelsByProvider as any).fireworks || []
  const xaiOptions = (modelsByProvider as any).xai || []


  // Debug logging


  // Indexing state (centralized)
  const [idxStatus, setIdxStatus] = useState<any>(null)
  const [idxLoading, setIdxLoading] = useState(false)
  const [idxQuery, setIdxQuery] = useState('')
  const [idxResults, setIdxResults] = useState<any[]>([])
  const [idxProg, setIdxProg] = useState<any>(null)

  // Index auto-refresh configuration
  const [idxAutoRefresh, setIdxAutoRefresh] = useState<any>(null)
  const [idxLastRebuildAt, setIdxLastRebuildAt] = useState<number | null>(null)


  // Use local state for index query to avoid IPC calls on every keystroke
  const [localIdxQuery, setLocalIdxQuery] = useState(idxQuery)

  // Sync local state when store changes
  useEffect(() => {
    setLocalIdxQuery(idxQuery)
  }, [idxQuery])

  // Hydrate settings + indexing snapshots and subscribe to progress on mount
  useEffect(() => {
    const client = getBackendClient(); if (!client) return

    // Settings snapshot
    client.rpc<any>('settings.get', {}).then((snap) => {
      if (!snap?.ok) return
      setModelsByProvider(snap.modelsByProvider || {})
      setDefaultModels(snap.defaultModels || {})
      setAutoRetry(!!snap.autoRetry)
      setStartupMessage(snap.startupMessage || null)
      setFireworksAllowed(snap.fireworksAllowedModels || [])
      // Hydrate API keys into the hook
      setApiKeys(snap.settingsApiKeys || {})
    }).catch(() => { })

    // Index snapshot
    client.rpc<any>('idx.status', {}).then((s) => {
      if (!s?.ok) return
      setIdxStatus(s.status || null)
      setIdxProg(s.progress || null)
      setIdxAutoRefresh(s.autoRefresh || null)
      setIdxLastRebuildAt(s.lastRebuildAt ?? null)
    }).catch(() => { })

    // Subscribe to progress
    client.rpc('idx.subscribe', {}).catch(() => { })
    const unsub = client.subscribe('idx.progress', (p: any) => {
      setIdxStatus(p?.status || null)
      setIdxProg(p?.progress || null)
    })
    return () => { try { unsub?.() } catch { } }
  }, [])



  const doRebuildIndex = async () => {
    const client = getBackendClient(); if (!client) return
    setIdxLoading(true)
    try {
      const res: any = await client.rpc('idx.rebuild', {})
      if (res?.ok) {
        notifications.show({ color: 'teal', title: 'Index rebuilt', message: `Chunks: ${res?.status?.chunks ?? 0}` })
        // Refresh status
        const s: any = await client.rpc('idx.status', {})
        if (s?.ok) {
          setIdxStatus(s.status || null)
          setIdxProg(s.progress || null)
          setIdxLastRebuildAt(s.lastRebuildAt ?? null)
        }
      } else if (res?.error) {
        notifications.show({ color: 'red', title: 'Index rebuild failed', message: String(res.error) })
      }
    } catch (e: any) {
      notifications.show({ color: 'red', title: 'Index rebuild failed', message: e?.message || String(e) })
    } finally {
      setIdxLoading(false)
    }
  }

  const doClearIndex = async () => {
    const client = getBackendClient(); if (!client) return
    try { await client.rpc('idx.clear', {}) } catch { }
  }

  const doSearchIndex = async () => {
    const client = getBackendClient(); if (!client) return
    try {
      setIdxQuery(localIdxQuery)
      const res: any = await client.rpc('idx.search', { query: localIdxQuery, limit: 20 })
      if (res?.ok) setIdxResults(res.results || [])
    } catch { }
  }

  const save = async () => {
    const client = getBackendClient(); if (!client) return
    try {
      // Use the hook's saveAndValidate function
      await saveAndValidate()

      // Refresh snapshot (models, defaultModels, etc.)
      const snap: any = await client.rpc('settings.get', {})
      if (snap?.ok) {
        setModelsByProvider(snap.modelsByProvider || {})
        setDefaultModels(snap.defaultModels || {})
        setAutoRetry(!!snap.autoRetry)
        setStartupMessage(snap.startupMessage || null)
        setFireworksAllowed(snap.fireworksAllowedModels || [])
      }
    } catch (e: any) {
      console.error('[SettingsPane] Save error:', e)
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
          <Text size="sm" c="dimmed">Configure provider API keys (persisted locally via Electron Store in the main process)</Text>
        </div>

        <ApiKeysForm
          apiKeys={apiKeys}
          onChange={setApiKeys}
          providerValid={providerValid}
          showValidation={true}
        />

        {/* Fireworks Models Allowlist (only when Fireworks key is valid) */}
        {(providerValid as any).fireworks && (
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
              <Button
                onClick={async () => {
                  const v = newFwModel.trim(); if (!v) return
                  const client = getBackendClient(); if (!client) return
                  await client.rpc('provider.fireworks.add', { model: v })
                  setNewFwModel('')
                  const snap: any = await client.rpc('settings.get', {})
                  if (snap?.ok) { setFireworksAllowed(snap.fireworksAllowedModels || []); setModelsByProvider(snap.modelsByProvider || {}) }
                }}
                disabled={!newFwModel.trim()}
              >
                Add
              </Button>
              <Button variant="light" onClick={async () => {
                const client = getBackendClient(); if (!client) return
                await client.rpc('provider.fireworks.loadDefaults', {})
                const snap: any = await client.rpc('settings.get', {}); if (snap?.ok) setFireworksAllowed(snap.fireworksAllowedModels || [])
              }}>
                Load Recommended Defaults
              </Button>
              <Button variant="light" onClick={async () => {
                const client = getBackendClient(); if (!client) return
                await client.rpc('provider.refreshModels', { provider: 'fireworks' })
                const snap: any = await client.rpc('settings.get', {}); if (snap?.ok) setModelsByProvider(snap.modelsByProvider || {})
              }}>
                Refresh
              </Button>
            </Group>

            {/* Current allowlist */}
            <Stack gap={4}>
              {fireworksAllowed.length === 0 ? (
                <Text size="xs" c="dimmed">No allowed models yet.</Text>
              ) : (
                fireworksAllowed.map((m: string) => (
                  <Group key={m} justify="space-between" wrap="nowrap">
                    <Text size="xs" c="#ccc" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</Text>

                    <Button size="xs" variant="light" color="red" onClick={async () => { const client = getBackendClient(); if (!client) return; await client.rpc('provider.fireworks.remove', { model: m }); const snap: any = await client.rpc('settings.get', {}); if (snap?.ok) setFireworksAllowed(snap.fireworksAllowedModels || []) }}>Remove</Button>
                  </Group>
                ))
              )}
            </Stack>
          </Stack>
        )}

        <Divider />

        <Group>
          <Button onClick={save} loading={saving || validating}>
            Save & Validate Keys
          </Button>
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
            onChange={(v) => { if (!v) return; const client = getBackendClient(); if (!client) return; client.rpc('provider.setDefaultModel', { provider: 'openai', model: v }); setDefaultModels((d) => ({ ...d, openai: v as string })) }}
            disabled={!providerValid.openai || openaiOptions.length === 0}
            description={!providerValid.openai ? 'Add an OpenAI API key first' : openaiOptions.length === 0 ? 'Loading models...' : undefined}
          />
          <Select
            label="Anthropic Default Model"
            placeholder="Select a model..."
            data={anthropicOptions}
            value={defaultModels?.anthropic || null}
            onChange={(v) => { if (!v) return; const client = getBackendClient(); if (!client) return; client.rpc('provider.setDefaultModel', { provider: 'anthropic', model: v }); setDefaultModels((d) => ({ ...d, anthropic: v as string })) }}
            disabled={!providerValid.anthropic || anthropicOptions.length === 0}
            description={!providerValid.anthropic ? 'Add an Anthropic API key first' : anthropicOptions.length === 0 ? 'Loading models...' : undefined}
          />
          <Select
            label="Gemini Default Model"
            placeholder="Select a model..."
            data={geminiOptions}
            value={defaultModels?.gemini || null}
            onChange={(v) => { if (!v) return; const client = getBackendClient(); if (!client) return; client.rpc('provider.setDefaultModel', { provider: 'gemini', model: v }); setDefaultModels((d) => ({ ...d, gemini: v as string })) }}
            disabled={!providerValid.gemini || geminiOptions.length === 0}
            description={!providerValid.gemini ? 'Add a Gemini API key first' : geminiOptions.length === 0 ? 'Loading models...' : undefined}
          />
          {(providerValid as any).fireworks && (
            <Select
              label="Fireworks Default Model"
              placeholder="Select a model..."
              data={fireworksOptions}
              value={(defaultModels as any)?.fireworks || null}
              onChange={(v) => { if (!v) return; const client = getBackendClient(); if (!client) return; client.rpc('provider.setDefaultModel', { provider: 'fireworks', model: v }); setDefaultModels((d) => ({ ...d, fireworks: v as string })) }}
              disabled={fireworksOptions.length === 0}
              description={fireworksOptions.length === 0 ? 'Populate allowlist or refresh models' : undefined}
            />
          )}
          <Select
            label="xAI Default Model"
            placeholder="Select a model..."
            data={xaiOptions}
            value={(defaultModels as any)?.xai || null}
            onChange={(v) => { if (!v) return; const client = getBackendClient(); if (!client) return; client.rpc('provider.setDefaultModel', { provider: 'xai', model: v }); setDefaultModels((d) => ({ ...d, xai: v as string })) }}
            disabled={!(providerValid as any).xai || xaiOptions.length === 0}
            description={!(providerValid as any).xai ? 'Add an xAI API key first' : xaiOptions.length === 0 ? 'Loading models...' : undefined}
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
            onChange={(e) => { const v = e.currentTarget.checked; const client = getBackendClient(); if (client) client.rpc('provider.setAutoRetry', { value: v }); setAutoRetry(v) }}
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
        <PricingSettings modelsByProvider={modelsByProvider} providerValid={providerValid} />
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
                <Text size="xs" c="dimmed">
                  Index path: {idxStatus.indexPath}
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
                  <Button variant="light" color="orange" onClick={async () => { const client = getBackendClient(); if (client) await client.rpc('idx.cancel', {}) }} size="sm">
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
              {idxProg.phase || 'idle'} • Files: {idxProg.processedFiles ?? 0}/{idxProg.totalFiles ?? 0} • Chunks: {idxProg.processedChunks ?? 0}/{idxProg.totalChunks ?? 0} • {Math.round((idxProg.elapsedMs || 0) / 1000)}s

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
              onChange={(e) => { const v = e.currentTarget.checked; const client = getBackendClient(); if (client) client.rpc('idx.setAutoRefresh', { config: { enabled: v } }); setIdxAutoRefresh((c: any) => ({ ...(c || {}), enabled: v })) }}
            />

            <Group grow>
              <NumberInput
                label="TTL (minutes)"
                description="Rebuild if index is older than this"
                min={5}
                max={1440}
                step={5}
                value={idxAutoRefresh?.ttlMinutes ?? 120}
                onChange={(v) => { if (typeof v !== 'number') return; const val = Math.max(5, Math.min(1440, v)); const client = getBackendClient(); if (client) client.rpc('idx.setAutoRefresh', { config: { ttlMinutes: val } }); setIdxAutoRefresh((c: any) => ({ ...(c || {}), ttlMinutes: val })) }}
              />
              <NumberInput
                label="Min interval (minutes)"
                description="Backoff between rebuilds to avoid thrash"
                min={1}
                max={120}
                step={1}
                value={idxAutoRefresh?.minIntervalMinutes ?? 10}
                onChange={(v) => { if (typeof v !== 'number') return; const val = Math.max(1, Math.min(120, v)); const client = getBackendClient(); if (client) client.rpc('idx.setAutoRefresh', { config: { minIntervalMinutes: val } }); setIdxAutoRefresh((c: any) => ({ ...(c || {}), minIntervalMinutes: val })) }}
              />
            </Group>

            <Group grow>
              <NumberInput
                label="File change threshold (absolute)"
                description="Rebuild when this many files change"
                min={0}
                step={10}
                value={idxAutoRefresh?.changeAbsoluteThreshold ?? 100}
                onChange={(v) => { if (typeof v !== 'number') return; const val = Math.max(0, v); const client = getBackendClient(); if (client) client.rpc('idx.setAutoRefresh', { config: { changeAbsoluteThreshold: val } }); setIdxAutoRefresh((c: any) => ({ ...(c || {}), changeAbsoluteThreshold: val })) }}
              />
              <NumberInput
                label="File change threshold (%)"
                description="Rebuild when this fraction of files changes"
                min={0}
                max={1}
                step={0.01}

                value={idxAutoRefresh?.changePercentThreshold ?? 0.02}
                onChange={(v) => { if (typeof v !== 'number') return; const val = Math.max(0, Math.min(1, v)); const client = getBackendClient(); if (client) client.rpc('idx.setAutoRefresh', { config: { changePercentThreshold: val } }); setIdxAutoRefresh((c: any) => ({ ...(c || {}), changePercentThreshold: val })) }}
              />
            </Group>

            <Switch
              label="Trigger on lockfile changes"
              description="Rebuild when package lockfiles change"
              checked={!!idxAutoRefresh?.lockfileTrigger}
              onChange={(e) => { const v = e.currentTarget.checked; const client = getBackendClient(); if (client) client.rpc('idx.setAutoRefresh', { config: { lockfileTrigger: v } }); setIdxAutoRefresh((c: any) => ({ ...(c || {}), lockfileTrigger: v })) }}
            />
            <TextInput
              label="Lockfile globs"
              description="Comma-separated list"
              value={(idxAutoRefresh?.lockfileGlobs || []).join(', ')}
              onChange={(e) => {
                const arr = e.currentTarget.value.split(',').map(s => s.trim()).filter(Boolean)
                { const client = getBackendClient(); if (client) client.rpc('idx.setAutoRefresh', { config: { lockfileGlobs: arr } }); setIdxAutoRefresh((c: any) => ({ ...(c || {}), lockfileGlobs: arr })) }
              }}
              placeholder="pnpm-lock.yaml, package-lock.json, yarn.lock"
            />

            <Group grow>
              <Switch
                label="Trigger on embedding model change"
                checked={!!idxAutoRefresh?.modelChangeTrigger}
                onChange={(e) => { const v = e.currentTarget.checked; const client = getBackendClient(); if (client) client.rpc('idx.setAutoRefresh', { config: { modelChangeTrigger: v } }); setIdxAutoRefresh((c: any) => ({ ...(c || {}), modelChangeTrigger: v })) }}
              />
              <NumberInput
                label="Max rebuilds per hour"
                min={0}
                max={12}
                step={1}
                value={idxAutoRefresh?.maxRebuildsPerHour ?? 3}
                onChange={(v) => { if (typeof v !== 'number') return; const val = Math.max(0, Math.min(12, v)); const client = getBackendClient(); if (client) client.rpc('idx.setAutoRefresh', { config: { maxRebuildsPerHour: val } }); setIdxAutoRefresh((c: any) => ({ ...(c || {}), maxRebuildsPerHour: val })) }}
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

