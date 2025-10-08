import { useEffect, useState } from 'react'
import { Button, Group, Stack, Text, TextInput, Title, Select, Switch, Slider, Progress } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useAppStore } from './store/app'

export default function SettingsPane() {
  const { selectedProvider, setSelectedProvider, selectedModel, setSelectedModel, autoRetry, setAutoRetry, defaultModels, setDefaultModel, setProvidersValid, autoApproveEnabled, setAutoApproveEnabled, autoApproveThreshold, setAutoApproveThreshold, autoEnforceEditsSchema, setAutoEnforceEditsSchema } = useAppStore()
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const existing = await window.secrets?.getApiKey?.()
        if (existing) setApiKey(existing)
      } catch {}
    })()
  }, [])
  const [anthropicKey, setAnthropicKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const ak = await window.secrets?.getApiKeyFor?.('anthropic')
        if (ak) setAnthropicKey(ak)
      } catch {}
      try {
        const gk = await window.secrets?.getApiKeyFor?.('gemini')
        if (gk) setGeminiKey(gk)
      } catch {}
    })()
  }, [])

  // Indexing state
  const [idxStatus, setIdxStatus] = useState<{ ready: boolean; chunks: number; modelId?: string; dim?: number; indexPath: string } | null>(null)
  const [idxLoading, setIdxLoading] = useState(false)
  const [idxQuery, setIdxQuery] = useState('')
  const [idxResults, setIdxResults] = useState<Array<{ path: string; startLine: number; endLine: number; text: string }>>([])

  const [idxProg, setIdxProg] = useState<{ inProgress?: boolean; phase?: string; processedFiles?: number; totalFiles?: number; processedChunks?: number; totalChunks?: number; elapsedMs?: number } | null>(null)

  useEffect(() => {
    const handler = (_: any, p: any) => {
      setIdxProg(p)
      if (p?.chunks !== undefined) {
        setIdxStatus((s) => s ? { ...s, chunks: p.chunks, ready: p.ready ?? s.ready, modelId: p.modelId ?? s.modelId, dim: p.dim ?? s.dim } : s)
      }
    }
    window.ipcRenderer?.on('index:progress', handler)
    return () => { window.ipcRenderer?.off('index:progress', handler) }
  }, [])

  const refreshIndexStatus = async () => {
    try {
      const res = await window.indexing?.status?.()
      if (res?.ok) setIdxStatus(res.status || null)
    } catch {}
  }
  useEffect(() => { refreshIndexStatus() }, [])

  const rebuildIndex = async () => {
    setIdxLoading(true)
    try {
      const res = await window.indexing?.rebuild?.()
      if (res?.ok) {
        setIdxStatus(res.status || null)
        notifications.show({ color: 'teal', title: 'Index rebuilt', message: `Chunks: ${res?.status?.chunks ?? 0}` })
      } else if (res?.error) {
        notifications.show({ color: 'red', title: 'Index rebuild failed', message: String(res.error) })
      }
    } finally {
      setIdxLoading(false)
    }
  }

  const clearIndex = async () => {
    try {
      const res = await window.indexing?.clear?.()
      if (res?.ok) {
        setIdxStatus((s) => s ? { ...s, ready: false, chunks: 0 } : s)
      }
    } catch {}
  }

  const searchIndex = async () => {
    try {
      const res = await window.indexing?.search?.(idxQuery.trim(), 5)
      if (res?.ok) setIdxResults(res.chunks || [])
    } catch {}
  }



  const save = async () => {
    setLoading(true)
    setSaved(false)
    try {
      // Save keys
      await window.secrets?.setApiKey?.(apiKey.trim())
      await window.secrets?.setApiKeyFor?.('anthropic', anthropicKey.trim())
      await window.secrets?.setApiKeyFor?.('gemini', geminiKey.trim())
      // Validate keys (best-effort)
      const vOpenAI = apiKey ? await window.secrets?.validateApiKeyFor?.('openai', apiKey) : { ok: true }
      const vAnth = anthropicKey ? await window.secrets?.validateApiKeyFor?.('anthropic', anthropicKey, 'claude-3-5-sonnet') : { ok: true }
      const vGem = geminiKey ? await window.secrets?.validateApiKeyFor?.('gemini', geminiKey, 'gemini-1.5-pro') : { ok: true }

      const failures: string[] = []
      if (!vOpenAI?.ok) failures.push(`OpenAI: ${vOpenAI?.error || 'invalid key'}`)
      if (!vAnth?.ok) failures.push(`Anthropic: ${vAnth?.error || 'invalid key'}`)
      if (!vGem?.ok) failures.push(`Gemini: ${vGem?.error || 'invalid key'}`)

      const validMap = {
        openai: Boolean(apiKey && vOpenAI?.ok),
        anthropic: Boolean(anthropicKey && vAnth?.ok),
        gemini: Boolean(geminiKey && vGem?.ok),
      }
      setProvidersValid(validMap)

      if (failures.length === 0) {
        notifications.show({ color: 'teal', title: 'API keys validated', message: 'All configured provider keys look good.' })
      } else {
        notifications.show({ color: 'orange', title: 'Some keys failed validation', message: failures.join(' | ') })
        console.warn('Key validation failed:', { vOpenAI, vAnth, vGem })
      }

      setSaved(true)
    } finally {
      setLoading(false)
    }

  }


  return (
    <Stack gap="lg">
      <Stack gap={6}>
        <Title order={4}>Settings</Title>
        <Text size="sm" c="dimmed">Manage provider API keys (stored securely via OS keychain)</Text>
        <Group align="flex-end">
          <TextInput style={{ flex: 1 }} label="OpenAI API Key" placeholder="sk-..." type="password" value={apiKey} onChange={(e) => setApiKey(e.currentTarget.value)} />
          <Button onClick={save} loading={loading}>Save</Button>
          {saved && <Text c="teal">Saved</Text>}
        </Group>
        <Group grow>
          <TextInput label="Anthropic API Key" placeholder="sk-ant-..." type="password" value={anthropicKey} onChange={(e) => setAnthropicKey(e.currentTarget.value)} />
          <TextInput label="Gemini API Key" placeholder="AI..." type="password" value={geminiKey} onChange={(e) => setGeminiKey(e.currentTarget.value)} />
        </Group>
        <Group grow>
          <Select
            label="Provider"
            data={[
              { value: 'openai', label: 'OpenAI' },
              { value: 'anthropic', label: 'Anthropic (placeholder)' },
              { value: 'gemini', label: 'Gemini (placeholder)' },
            ]}
            value={selectedProvider}
            onChange={(v) => v && setSelectedProvider(v)}
          />
          <TextInput
            label="Model"
            placeholder={selectedProvider === 'openai' ? 'gpt-5' : selectedProvider === 'anthropic' ? 'claude-3-5-sonnet' : 'gemini-1.5-pro'}
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.currentTarget.value)}
          />
          <Switch
            label="Auto-retry stream on error"
            checked={autoRetry}
            onChange={(e) => setAutoRetry(e.currentTarget.checked)}
          />
        </Group>
        <Group grow>
          <Select
            label="Default OpenAI model"
            data={[

              { value: 'gpt-5', label: 'GPT-5' },
              { value: 'gpt-4.1', label: 'GPT-4.1' },
              { value: 'gpt-4o', label: 'GPT-4o' },
              { value: 'gpt-4o-mini', label: 'GPT-4o-mini' },
            ]}
            value={defaultModels?.openai || 'gpt-5'}
            onChange={(v) => v && setDefaultModel('openai', v)}
          />
          <Select
            label="Default Anthropic model"
            data={[
              { value: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
              { value: 'claude-3-opus', label: 'Claude 3 Opus' },
              { value: 'claude-3-haiku', label: 'Claude 3 Haiku' },
            ]}
            value={defaultModels?.anthropic || 'claude-3-5-sonnet'}
            onChange={(v) => v && setDefaultModel('anthropic', v)}
          />
          <Select
            label="Default Gemini model"
            data={[
              { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
              { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
              { value: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash 8B' },
            ]}
            value={defaultModels?.gemini || 'gemini-1.5-pro'}
            onChange={(v) => v && setDefaultModel('gemini', v)}
          />
        </Group>
        <Group grow>
          <Switch
            label="Auto-approve risky commands"
            checked={autoApproveEnabled}
            onChange={(e) => setAutoApproveEnabled(e.currentTarget.checked)}
          />
          <Stack gap={2} style={{ minWidth: 220 }}>
            <Text size="sm">Auto-approve threshold: {autoApproveThreshold.toFixed(2)}</Text>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={autoApproveThreshold}
              onChange={setAutoApproveThreshold}
            />
          </Stack>
        </Group>
        <Group grow>
          <Switch
            label="Auto-enforce structured edits schema (when changing code)"
            checked={autoEnforceEditsSchema}
            onChange={(e) => setAutoEnforceEditsSchema(e.currentTarget.checked)}
          />
        </Group>

      </Stack>
        {/* Indexing Section */}
        <Stack gap={6} mt="xl">
          <Title order={4}>Indexing (local)</Title>
          <Text size="sm" c="dimmed">Build a local embeddings index for retrieval; no cloud calls.</Text>
          <Group align="flex-end">
            <Button onClick={rebuildIndex} loading={idxLoading}>Rebuild index</Button>
            <Button variant="light" color="red" onClick={clearIndex}>Clear</Button>
            {idxProg?.inProgress && (
              <Button variant="light" color="orange" onClick={() => window.indexing?.cancel?.()}>Cancel</Button>
            )}
            <Text size="sm" c="dimmed">
              {idxStatus ? `Status: ${idxStatus.ready ? 'ready' : 'not ready'} | chunks: ${idxStatus.chunks} | model: ${idxStatus.modelId || 'local'} | dim: ${idxStatus.dim || 384}` : 'Status: unknown'}
            </Text>
          </Group>
          {idxProg && (
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
                Phase: {idxProg.phase || 'idle'} | files: {idxProg.processedFiles ?? 0}/{idxProg.totalFiles ?? 0} | chunks: {idxProg.processedChunks ?? 0}/{idxProg.totalChunks ?? 0} | elapsed: {Math.round((idxProg.elapsedMs || 0)/1000)}s
              </Text>
            </Stack>
          )}
          <Group align="flex-end">
            <TextInput style={{ flex: 1 }} label="Search test" placeholder="e.g. where do we validate provider keys?" value={idxQuery} onChange={(e) => setIdxQuery(e.currentTarget.value)} />
            <Button variant="subtle" onClick={searchIndex}>Search</Button>
          </Group>
          {idxResults.length > 0 && (
            <Stack gap={4} pl="xs">
              {idxResults.slice(0, 5).map((r, i) => (
                <Text key={i} size="sm">{r.path}:{r.startLine}-{r.endLine}</Text>
              ))}
            </Stack>
          )}
        </Stack>

    </Stack>
  )
}

