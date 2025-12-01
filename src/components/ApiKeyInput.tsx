import { TextInput, Loader, Text } from '@mantine/core'

interface ApiKeyInputProps {
  provider: 'openai' | 'anthropic' | 'gemini' | 'fireworks' | 'xai'
  value: string
  onChange: (value: string) => void
  isValid?: boolean
  isValidating?: boolean
  showValidation?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

const PROVIDER_CONFIG = {
  openai: {
    label: 'OpenAI API Key',
    placeholder: 'sk-...',
  },
  anthropic: {
    label: 'Anthropic API Key',
    placeholder: 'sk-ant-...',
  },
  gemini: {
    label: 'Gemini API Key',
    placeholder: 'AIza...',
  },
  fireworks: {
    label: 'Fireworks API Key',
    placeholder: 'fk-...',
  },
  xai: {
    label: 'xAI API Key',
    placeholder: 'xai-...',
  },
} as const

export function ApiKeyInput({
  provider,
  value,
  onChange,
  isValid,
  isValidating,
  showValidation = true,
  size = 'sm',
}: ApiKeyInputProps) {
  const config = PROVIDER_CONFIG[provider]

  return (
    <TextInput
      label={config.label}
      placeholder={config.placeholder}
      type="password"
      size={size}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      rightSection={
        showValidation ? (
          isValidating ? (
            <Loader size="xs" />
          ) : isValid ? (
            <Text size="xs" c="teal">
              ✓
            </Text>
          ) : null
        ) : null
      }
    />
  )
}

