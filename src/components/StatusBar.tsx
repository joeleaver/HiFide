import { useEffect, useMemo } from 'react'
import { Group, Text, UnstyledButton, Select } from '@mantine/core'
import { IconFolder, IconChevronDown } from '@tabler/icons-react'
import { useAppStore } from '../store/app'

const STATUS_BAR_HEIGHT = 24

export default function StatusBar() {
  const selectedFolder = useAppStore((s) => s.selectedFolder)
  const setSelectedFolder = useAppStore((s) => s.setSelectedFolder)
  const selectedModel = useAppStore((s) => s.selectedModel)
  const setSelectedModel = useAppStore((s) => s.setSelectedModel)
  const selectedProvider = useAppStore((s) => s.selectedProvider)
  const setSelectedProvider = useAppStore((s) => s.setSelectedProvider)
  const providerValid = useAppStore((s) => s.providerValid)

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

  const modelOptions = useMemo(() => {
    if (selectedProvider === 'anthropic') {
      return [
        { value: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
        { value: 'claude-3-opus', label: 'Claude 3 Opus' },
        { value: 'claude-3-haiku', label: 'Claude 3 Haiku' },
      ]
    }
    if (selectedProvider === 'gemini') {
      return [
        { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
        { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
        { value: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash 8B' },
      ]
    }
    return [
      { value: 'gpt-5', label: 'GPT-5' },
      { value: 'gpt-4.1', label: 'GPT-4.1' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4o-mini', label: 'GPT-4o-mini' },
    ]
  }, [selectedProvider])

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
  }, [selectedProvider, JSON.stringify(modelOptions), defaultModels?.[selectedProvider]])

  // Set current working directory as default folder on mount
  useEffect(() => {
    const initFolder = async () => {
      if (!selectedFolder && window.fs) {
        try {
          const cwd = await window.fs.getCwd()
          setSelectedFolder(cwd)
        } catch (error) {
          console.error('Failed to get current working directory:', error)
        }
      }
    }
    initFolder()
  }, [selectedFolder, setSelectedFolder])

  // Auto (re)build local index when a folder is opened and no index exists yet
  useEffect(() => {
    let cancelled = false
    const maybeBuildIndex = async () => {
      try {
        const res = await window.indexing?.status?.()
        const exists = !!res?.status?.exists
        const ready = !!res?.status?.ready
        const chunks = res?.status?.chunks ?? 0
        if (!exists || (!ready && chunks === 0)) {
          await window.indexing?.rebuild?.()
        }
      } catch {}
      if (cancelled) return
    }
    // Trigger when a folder is selected
    if (selectedFolder) {
      void maybeBuildIndex()
    }
    return () => { cancelled = true }
  }, [selectedFolder])

  const handleFolderClick = async () => {
    // Placeholder for folder picker - will implement later
    console.log('Folder picker clicked')
    // For now, just toggle between null and a placeholder
    if (selectedFolder) {
      setSelectedFolder(null)
    } else {
      setSelectedFolder('C:\\Users\\joe\\Documents\\wifide')
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
            {selectedFolder ? selectedFolder.split('\\').pop() || selectedFolder : 'No Folder Open'}
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

