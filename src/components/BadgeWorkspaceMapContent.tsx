import { memo, useEffect, useState } from 'react'
import { Stack, Text, Group, Badge, Code, Card, Loader, Divider } from '@mantine/core'
import { getBackendClient } from '../lib/backend/bootstrap'

interface BadgeWorkspaceMapContentProps {
  badgeId: string
  mapKey: string
}

interface SectionItem {
  path: string
  handle?: string
  score?: number
  details?: string
  stats?: Record<string, number | string>
}

interface Section {
  title: string
  items: SectionItem[]
}

interface WorkspaceMapMeta {
  elapsedMs: number
  totalFiles: number
  totalBytes: number
  maxFileBytes: number
  detectedLanguages?: string[]
}

interface WorkspaceMapResult {
  root: string
  sections: Section[]
  meta?: WorkspaceMapMeta
}

const numberFormatter = new Intl.NumberFormat('en-US')

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes)) return `${bytes}`
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let val = bytes / 1024
  let unitIndex = 0
  while (val >= 1024 && unitIndex < units.length - 1) {
    val /= 1024
    unitIndex += 1
  }
  return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function formatStatValue(key: string, value: number | string) {
  if (typeof value === 'number') {
    if (key.toLowerCase().includes('byte')) {
      return formatBytes(value)
    }
    return numberFormatter.format(value)
  }
  return String(value)
}

function renderDetails(details: string) {
  const trimmed = details.trim()
  const isCodeBlock = trimmed.startsWith('```') && trimmed.endsWith('```')
  const content = isCodeBlock ? trimmed.replace(/^```/, '').replace(/```$/, '').trim() : trimmed
  if (isCodeBlock || trimmed.includes('\n')) {
    return (
      <Code
        block
        style={{
          fontSize: 11,
          lineHeight: 1.4,
          background: '#0d0d0d',
          border: '1px solid #2d2d2d',
          padding: '6px 8px'
        }}
      >
        {content}
      </Code>
    )
  }

  return (
    <Text size="xs" c="gray.3">
      {content}
    </Text>
  )
}

const MetaBadge = ({ label, value }: { label: string; value: string }) => (
  <Badge size="xs" variant="light" color="gray">
    <Text size="xs" fw={500}>
      {label}: {value}
    </Text>
  </Badge>
)

export const BadgeWorkspaceMapContent = memo(function BadgeWorkspaceMapContent({
  badgeId,
  mapKey
}: BadgeWorkspaceMapContentProps) {
  void badgeId
  const [data, setData] = useState<WorkspaceMapResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const client = getBackendClient()
    if (!client) return
    client
      .rpc('tool.getResult', { key: mapKey })
      .then((res: any) => {
        const payload = (res?.result ?? res?.data ?? res) as WorkspaceMapResult
        setData(payload)
      })
      .catch(() => {
        setError('Failed to load workspace map results')
      })
  }, [mapKey])

  if (error) {
    return (
      <Text size="sm" c="red.4">
        {error}
      </Text>
    )
  }

  if (!data) {
    return (
      <Group gap={8}>
        <Loader size="xs" />
        <Text size="sm" c="dimmed">
          Loading workspace map...
        </Text>
      </Group>
    )
  }

  const meta = data.meta || {} as WorkspaceMapMeta

  return (
    <Stack gap={14}>
      <div>
        <Text size="xs" fw={600} c="dimmed" mb={4}>
          Workspace root
        </Text>
        <Code
          block
          style={{
            fontSize: 11,
            lineHeight: 1.4,
            background: '#0d0d0d',
            border: '1px solid #2d2d2d',
            padding: '6px 8px'
          }}
        >
          {data.root || '.'}
        </Code>
      </div>

      <Group gap={8} wrap="wrap">
        {Number.isFinite(meta.elapsedMs) && (
          <MetaBadge label="Elapsed" value={`${Math.round(meta.elapsedMs)} ms`} />
        )}
        {Number.isFinite(meta.totalFiles) && (
          <MetaBadge label="Files" value={numberFormatter.format(meta.totalFiles)} />
        )}
        {Number.isFinite(meta.totalBytes) && (
          <MetaBadge label="Bytes" value={formatBytes(meta.totalBytes)} />
        )}
        {Number.isFinite(meta.maxFileBytes) && (
          <MetaBadge label="Largest file" value={formatBytes(meta.maxFileBytes)} />
        )}
        {meta.detectedLanguages?.length ? (
          <MetaBadge label="Languages" value={meta.detectedLanguages.join(', ')} />
        ) : null}
      </Group>

      <Divider color="#2d2d2d" />

      {data.sections?.map((section, sectionIdx) => (
        <Stack key={`${section.title}-${sectionIdx}`} gap={8}>
          <Group gap={8}>
            <Text size="xs" fw={600} c="dimmed">
              {section.title}
            </Text>
            <Badge size="xs" variant="light" color="blue">
              {section.items?.length || 0} item{section.items?.length === 1 ? '' : 's'}
            </Badge>
          </Group>

          {!section.items?.length ? (
            <Text size="sm" c="dimmed">
              No data found for this section
            </Text>
          ) : (
            <Stack gap={10}>
              {section.items.map((item, itemIdx) => {
                const statsEntries = [
                  ...(item.score !== undefined ? [['score', item.score] as const] : []),
                  ...Object.entries(item.stats ?? {})
                ]

                return (
                  <Card
                    key={`${item.path}-${itemIdx}`}
                    withBorder
                    padding="sm"
                    radius="sm"
                    style={{ background: '#141414', borderColor: '#2d2d2d' }}
                  >
                    <Stack gap={6}>
                      <Text size="sm" fw={500} c="gray.1" style={{ fontFamily: 'var(--monospace-font, "JetBrains Mono", monospace)' }}>
                        {item.path}
                      </Text>

                      {statsEntries.length > 0 && (
                        <Group gap={6} wrap="wrap">
                          {statsEntries.map(([key, value]) => (
                            <Badge key={key} size="xs" variant="light" color="gray">
                              {key}: {formatStatValue(key, value)}
                            </Badge>
                          ))}
                        </Group>
                      )}

                      {item.details && renderDetails(item.details)}
                    </Stack>
                  </Card>
                )
              })}
            </Stack>
          )}
        </Stack>
      ))}
    </Stack>
  )
})
