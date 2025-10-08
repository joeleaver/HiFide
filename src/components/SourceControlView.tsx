import { Stack, Text, Center } from '@mantine/core'
import { IconGitBranch } from '@tabler/icons-react'

export default function SourceControlView() {
  return (
    <Center
      style={{
        flex: 1,
        height: '100%',
        backgroundColor: '#1e1e1e',
      }}
    >
      <Stack align="center" gap="md">
        <IconGitBranch size={64} stroke={1.5} color="#858585" />
        <Text size="lg" c="dimmed">
          Source Control
        </Text>
        <Text size="sm" c="dimmed">
          Git integration coming soon
        </Text>
      </Stack>
    </Center>
  )
}

