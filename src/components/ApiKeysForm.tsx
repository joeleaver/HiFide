import { Stack } from '@mantine/core'
import { ApiKeyInput } from './ApiKeyInput'

interface ApiKeysFormProps {
  apiKeys: Record<string, string>
  onChange: (keys: Record<string, string>) => void
  providerValid?: Record<string, boolean>
  showValidation?: boolean
  compact?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

const PROVIDERS = ['openai', 'anthropic', 'gemini', 'fireworks', 'xai'] as const

export function ApiKeysForm({
  apiKeys,
  onChange,
  providerValid,
  showValidation = true,
  compact = false,
  size = 'sm',
}: ApiKeysFormProps) {
  return (
    <Stack gap={compact ? 8 : 'sm'}>
      {PROVIDERS.map((provider) => (
        <ApiKeyInput
          key={provider}
          provider={provider}
          value={apiKeys[provider] || ''}
          onChange={(value) => onChange({ ...apiKeys, [provider]: value })}
          isValid={providerValid?.[provider]}
          showValidation={showValidation}
          size={size}
        />
      ))}
    </Stack>
  )
}

