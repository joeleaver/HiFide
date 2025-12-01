import { memo, useEffect, useMemo, useState } from 'react'
import { Code, Text, Group, Badge, Stack, Divider } from '@mantine/core'
import { getBackendClient } from '../lib/backend/bootstrap'

interface BadgeReadLinesContentProps {
  badgeId: string
  readKey: string
}

/**
 * Read-lines results content for expandable tool badges
 * Shows exactly what the tool returned (lines/text), plus small metadata
 */
export const BadgeReadLinesContent = memo(function BadgeReadLinesContent({ badgeId, readKey }: BadgeReadLinesContentProps) {
  void badgeId

  const [result, setResult] = useState<any>(undefined)

  useEffect(() => {
    const client = getBackendClient(); if (!client) return
    client.rpc('tool.getResult', { key: readKey }).then((res: any) => {
      // tool.getResult returns { ok: true, result: <data> }
      const data = res?.result ?? res?.data ?? res
      setResult(data)
    }).catch(() => {})
  }, [readKey])

  const contentInfo = useMemo(() => {
    if (!result) return { kind: 'none' as const, text: '' }

    // If tool returned raw string directly
    if (typeof result === 'string') {
      return { kind: 'text' as const, text: result }
    }

    // If tool returned raw text field
    if (typeof result.text === 'string' && result.text.length >= 0) {
      return { kind: 'text' as const, text: result.text }
    }

    // If tool returned numbered lines
    if (Array.isArray(result.lines)) {
      const linesText = result.lines
        .map((row: any) => `${String(row.line ?? '').toString().padStart(6, ' ')}: ${row.text ?? ''}`)
        .join('\n')
      return { kind: 'lines' as const, text: linesText }
    }

    // Fallback: show JSON of the result so we truly show "exactly what is returned"
    try {
      return { kind: 'json' as const, text: JSON.stringify(result, null, 2) }
    } catch {
      return { kind: 'json' as const, text: String(result) }
    }
  }, [result])

  if (result === undefined) {
    // Still loading from cache
    return (
      <Text size="xs" c="dimmed">Loading…</Text>
    )
  }

  return (
    <Stack gap={8}>
      {/* Summary row */}
      <Group gap={8}>
        <Text size="xs" fw={600} c="dimmed">Returned</Text>
        {typeof result?.lineCount === 'number' && (
          <Badge size="xs" variant="light" color="green">{result.lineCount} {result.lineCount === 1 ? 'line' : 'lines'}</Badge>
        )}
        {result?.truncated && (
          <Badge size="xs" variant="light" color="red">truncated</Badge>
        )}
        {typeof result?.startLine === 'number' && typeof result?.endLine === 'number' && (
          <Badge size="xs" variant="light" color="gray">L{result.startLine}-{result.endLine}</Badge>
        )}
      </Group>

      <Divider color="#3d3d3d" />

      {/* Exact returned content */}
      <Code
        block
        style={{
          fontSize: 11,
          lineHeight: 1.4,
          background: '#0d0d0d',
          border: '1px solid #2d2d2d',
          padding: 8,
          whiteSpace: 'pre',
        }}
      >
        {contentInfo.text}
      </Code>
    </Stack>
  )
})

