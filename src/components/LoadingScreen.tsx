import { Center, Loader, Stack, Text } from '@mantine/core'

type LoadingScreenProps = {
  message?: string | null
}

export default function LoadingScreen({ message }: LoadingScreenProps) {
  return (
    <Center style={{ width: '100vw', height: '100vh', backgroundColor: '#1e1e1e' }}>
      <Stack align="center" gap={8}>
        <Loader color="blue" />
        <Text c="dimmed" size="sm">{message || 'Loading…'}</Text>
      </Stack>
    </Center>
  )
}

