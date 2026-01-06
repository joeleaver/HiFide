import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Title,
  Select,
} from '@mantine/core'
import { IconPlus, IconRefresh, IconTrash } from '@tabler/icons-react'
import { getBackendClient } from '../lib/backend/bootstrap'

type MemoryItemType = 'decision' | 'constraint' | 'preference' | 'fact' | 'warning' | 'workflow'

const MEMORY_TYPES: Array<{ value: MemoryItemType; label: string }> = [
  { value: 'decision', label: 'decision' },
  { value: 'constraint', label: 'constraint' },
  { value: 'preference', label: 'preference' },
  { value: 'fact', label: 'fact' },
  { value: 'warning', label: 'warning' },
  { value: 'workflow', label: 'workflow' },
]

type WorkspaceMemoryItem = {
  id: string
  type: MemoryItemType
  text: string
  tags: string[]
  importance: number
  contentHash: string
  source: 'implicit-extraction' | 'user-edit' | 'system'
  enabled?: boolean
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
  usageCount?: number
}

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => t.toLowerCase())
}

export default function MemoriesView() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<WorkspaceMemoryItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Extraction type toggles are configured per extractMemories flow node.

  const selected = useMemo(
    () => items.find((m) => m.id === selectedId) || null,
    [items, selectedId]
  )

  const [draft, setDraft] = useState<WorkspaceMemoryItem | null>(null)

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const client = getBackendClient()
      const res: any = await client?.rpc('memories.list', {})
      if (!res?.ok) throw new Error(res?.error || 'Failed to load memories')
      const next: WorkspaceMemoryItem[] = Array.isArray(res.items) ? res.items : []
      const processed = next.map((m) => ({ ...m, enabled: m.enabled !== false }))
      setItems(processed)

      // keep selection if possible
      setSelectedId((prev) => {
        if (prev && processed.some((m) => m.id === prev)) return prev
        return processed[0]?.id ?? null
      })
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    
    const client = getBackendClient()
    if (!client) return

    const unsub = client.subscribe('workspace.attached', () => {
      load()
    })

    return () => {
      unsub()
    }
  }, [])

  useEffect(() => {
    if (selected) {
      setDraft({ ...selected })
    }
  }, [selectedId, selected])

  const save = async () => {
    if (!draft) return
    setLoading(true)
    setError(null)
    try {
      const client = getBackendClient()
      
      // Compute contentHash based on current text to pass schema validation
      const textToSave = draft.text.trim() || 'New memory…'
      const itemToSave = { 
        ...draft,
        text: textToSave,
        contentHash: draft.contentHash === 'new-memory-placeholder' || !draft.contentHash
          ? `uhash-${Math.random().toString(16).slice(2, 10)}` // Simple unique hash for user edit
          : draft.contentHash,
        source: 'user-edit' as const, 
        updatedAt: new Date().toISOString() 
      }
      
      const res: any = await client?.rpc('memories.upsert', { item: itemToSave })
      
      if (!res?.ok) throw new Error(res?.error || 'Failed to save memory')
      await load()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const createNew = async () => {
    const id = `mem_${Math.random().toString(16).slice(2)}_${Date.now()}`
    const now = new Date().toISOString()
    const item: WorkspaceMemoryItem = {
      id,
      type: 'fact',
      text: 'New memory…',
      tags: [],
      importance: 0.5,
      contentHash: 'new-memory-placeholder',
      source: 'user-edit',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }

    // Update local state first for immediate UI response
    setItems((prev) => [item, ...prev])
    setSelectedId(id)
    // Note: useEffect handles setDraft(item) when selectedId changes

    // Persist in background
    try {
      const client = getBackendClient()
      const res: any = await client?.rpc('memories.upsert', { item })
      if (!res?.ok) throw new Error(res?.error || 'Failed to create memory')
      // reload silently to avoid flashes
      await load(true)
    } catch (e: any) {
      setError(e?.message || String(e))
    }
  }

  const del = async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const client = getBackendClient()
      const res: any = await client?.rpc('memories.delete', { id })
      if (!res?.ok) throw new Error(res?.error || 'Failed to delete memory')
      await load()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Stack gap="sm" style={{ height: '100%', padding: 12 }}>
      <Group justify="space-between" align="center">
        <Title order={3}>Memories</Title>
        <Group gap="xs">
          <ActionIcon
            variant="subtle"
            onClick={() => {
              console.log('Refreshing memories...')
              load(false)
            }}
            aria-label="Refresh memories"
            loading={loading}
          >
            <IconRefresh size={18} />
          </ActionIcon>
          <Button leftSection={<IconPlus size={16} />} onClick={createNew}>
            New
          </Button>
        </Group>
      </Group>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}

      {/* NOTE: Extraction rules are now configured per extractMemories flow node.
          This screen only controls whether individual memories are enabled for retrieval. */}

      <Group align="stretch" style={{ flex: 1, minHeight: 0 }} gap="md">
        <Stack style={{ width: 360, minWidth: 300, borderRight: '1px solid #2a2a2a', paddingRight: 12 }} gap="xs">
          <Text size="sm" c="dimmed">
            {loading ? 'Loading…' : `${items.length} memories`}
          </Text>
          <ScrollArea style={{ flex: 1, display: 'flex' }} offsetScrollbars>
            <Stack gap={6} style={{ width: '100%' }}>
              {items.map((m) => (
                <Button
                  key={m.id}
                  variant={m.id === selectedId ? 'light' : 'subtle'}
                  onClick={() => setSelectedId(m.id)}
                  styles={{ 
                    root: { height: 'auto', padding: '8px 12px' },
                    inner: { justifyContent: 'space-between', display: 'block', width: '100%' } 
                  }}
                >
                  <Group gap="xs" justify="space-between" align="flex-start" wrap="nowrap" style={{ width: '100%' }}>
                    <Text size="sm" lineClamp={2} style={{ flex: 1, textAlign: 'left', wordBreak: 'break-word', whiteSpace: 'normal' }}>
                      {m.text}
                    </Text>
                    <Stack gap={4} align="flex-end" style={{ flexShrink: 0 }}>
                      <Badge variant="light" size="xs">{m.type}</Badge>
                      {m.enabled === false && <Badge color="gray" variant="light" size="xs">disabled</Badge>}
                    </Stack>
                  </Group>
                </Button>
              ))}
            </Stack>
          </ScrollArea>
        </Stack>

        <ScrollArea style={{ flex: 1, minWidth: 0 }} offsetScrollbars>
          <Stack gap="sm" style={{ paddingRight: 12 }}>
            {!draft ? (
              <Text c="dimmed">Select a memory to edit</Text>
            ) : (
              <>
              <Group justify="space-between">
                <Group gap="xs">
                  <Badge variant="light">{draft.type}</Badge>
                  <Text size="xs" c="dimmed">
                    id: {draft.id}
                  </Text>
                </Group>
                <Group gap="xs">
                  <ActionIcon color="red" variant="subtle" onClick={() => del(draft.id)} aria-label="Delete memory">
                    <IconTrash size={18} />
                  </ActionIcon>
                  <Button onClick={save} disabled={loading}>
                    Save
                  </Button>
                </Group>
              </Group>

              <Textarea
                label="Text"
                value={draft.text}
                minRows={3}
                autosize
                onChange={(e) => setDraft({ ...draft, text: e.currentTarget.value })}
              />

              <Switch
                label="Enabled"
                checked={draft.enabled !== false}
                onChange={(e) => setDraft({ ...draft, enabled: e.currentTarget.checked })}
              />

              <Select
                label="Type"
                data={MEMORY_TYPES}
                value={draft.type}
                onChange={(value) => {
                  if (!value) return
                  setDraft({ ...draft, type: value as MemoryItemType })
                }}
              />

              <TextInput
                label="Tags"
                description="Comma-separated"
                value={(draft.tags || []).join(', ')}
                onChange={(e) => setDraft({ ...draft, tags: parseTags(e.currentTarget.value) })}
              />

              <TextInput
                label="Importance"
                description="0..1"
                value={String(draft.importance ?? 0.5)}
                onChange={(e) => {
                  const n = Number(e.currentTarget.value)
                  setDraft({ ...draft, importance: Number.isFinite(n) ? n : draft.importance })
                }}
              />

              <Group gap="md">
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">source</Text>
                  <Text size="sm">{draft.source}</Text>
                </Stack>
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">created</Text>
                  <Text size="sm">{draft.createdAt}</Text>
                </Stack>
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">updated</Text>
                  <Text size="sm">{draft.updatedAt}</Text>
                </Stack>
              </Group>
            </>
          )}
          </Stack>
        </ScrollArea>
      </Group>

      {loading && (
        <Group gap="xs">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">Working…</Text>
        </Group>
      )}
    </Stack>
  )
}

