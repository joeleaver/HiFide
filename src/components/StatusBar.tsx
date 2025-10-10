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
  const refreshIndexStatus = useAppStore((s) => s.refreshIndexStatus)
  const rebuildIndex = useAppStore((s) => s.rebuildIndex)
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
  // Ensure selected provider is one of the validated ones
  useEffect(() => {
    if (!providerOptions.find((p) => p.value === selectedProvider) && providerOptions.length > 0) {
      setSelectedProvider(providerOptions[0].value as string)
    }
  }, [JSON.stringify(providerOptions), selectedProvider])


  const defaultModels = useAppStore((s) => s.defaultModels)

  // Models come from centralized store (no direct window.models calls here)
  const modelsByProvider = useAppStore((s) => s.modelsByProvider)
  const modelOptions = useMemo(() => modelsByProvider[selectedProvider] || [], [modelsByProvider, selectedProvider])
  // Models are refreshed during app init and when API keys are saved - no need to refresh on provider change

  // Default model when provider changes: prefer configured default; else first available
  useEffect(() => {
    const preferred = defaultModels?.[selectedProvider]
    const hasPreferred = preferred && modelOptions.some((m) => m.value === preferred)
    if (hasPreferred) {
      if (selectedModel !== preferred) setSelectedModel(preferred)
      return
    }
    if (!modelOptions.find((m) => m.value === selectedModel)) {
      const first = modelOptions[0]
      if (first?.value) setSelectedModel(first.value)
    }
  }, [selectedProvider, JSON.stringify(modelOptions), defaultModels?.[selectedProvider], selectedModel])

  // Ensure index progress subscription is active (StatusBar is always mounted)
  useEffect(() => {
    try { ensureIndexProgressSubscription() } catch {}
  }, [ensureIndexProgressSubscription])

  // Auto (re)build local index when a folder is opened and no index exists yet
  useEffect(() => {
    let cancelled = false
    const maybeBuildIndex = async () => {
      try {
        await refreshIndexStatus()
        const s = useAppStore.getState().idxStatus
        const ready = !!s?.ready
        const chunks = s?.chunks ?? 0
        if (!ready && chunks === 0) {
          await rebuildIndex()
        }
      } catch {}
      if (cancelled) return
    }
    // Trigger when a folder is selected
    if (workspaceRoot) {
      void maybeBuildIndex()
    }
    return () => { cancelled = true }
  }, [workspaceRoot, refreshIndexStatus, rebuildIndex])

  // Bootstrap workspace context on folder selection (via store action)
  useEffect(() => {
    if (!workspaceRoot) return
    ;(async () => {
      try {
        await useAppStore.getState().refreshContext()
      } catch {}
    })()
  }, [workspaceRoot])

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

      {/* Right side - Provider + Model selectors */}
      <Group gap={8}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', height: STATUS_BAR_HEIGHT }}>
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

