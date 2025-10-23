import { Center, Loader, Stack, Text, Title } from '@mantine/core'

type LoadingScreenProps = {
  message?: string | null
}

export default function LoadingScreen({ message }: LoadingScreenProps) {
  return (
    <Center style={{ width: '100vw', height: '100vh', backgroundColor: '#1e1e1e' }}>
      <Stack align="center" gap={12}>
        <div style={{ position: 'relative', width: 120, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="logo-glow" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
          <img
            src="/hifide-logo.png"
            alt="HiFide"
            style={{ width: 80, height: 80, objectFit: 'contain', filter: 'drop-shadow(0 0 12px rgba(0,0,0,0.35))', zIndex: 1 }}
          />
        </div>
        <Title order={2} style={{ letterSpacing: 0.5, color: '#e6e6e6', fontWeight: 800 }}>HiFide</Title>
        <Loader color="blue" />
        <Text c="dimmed" size="sm">{message || 'Loading…'}</Text>
      </Stack>
    </Center>
  )
}

