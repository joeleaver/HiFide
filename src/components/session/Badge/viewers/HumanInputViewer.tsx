import { Stack, Text, Group } from '@mantine/core'
import type { Badge as BadgeType } from '../../../../../electron/store/types'
import Markdown from '../../../Markdown'

export function HumanInputViewer({ badge }: { badge: BadgeType }) {
  const prompt = badge.args?.prompt || badge.metadata?.prompt || 'Question'
  const response = badge.result?.data || badge.result?.response || badge.metadata?.response

  const renderResponse = (resp: any) => {
    if (typeof resp === 'string') {
      return <Markdown content={resp} />
    }
    if (Array.isArray(resp)) {
      return (
        <Stack gap="xs">
          {resp.map((part: any, idx: number) => {
            if (part.type === 'text') return <Markdown key={idx} content={part.text} />
            if (part.type === 'image') return <Text key={idx} size="xs" c="dimmed">[Image Attachment]</Text>
            return null
          })}
        </Stack>
      )
    }
    return <Text size="xs" c="dimmed">No response data</Text>
  }

  return (
    <Stack gap="sm" p="xs">
      <Group gap="sm" align="flex-start" wrap="nowrap">
        <Text size="xs" fw={900} c="blue.4" style={{ minWidth: '20px', marginTop: '4px' }}>Q:</Text>
        <Text size="sm" fw={500} c="gray.2" style={{ lineHeight: 1.5, flex: 1 }}>{prompt}</Text>
      </Group>

      <Group gap="sm" align="flex-start" wrap="nowrap">
        <Text size="xs" fw={900} c="green.4" style={{ minWidth: '20px', marginTop: '4px' }}>A:</Text>
        <div style={{ flex: 1, minWidth: 0 }}>
          {renderResponse(response)}
        </div>
      </Group>
    </Stack>
  )
}
