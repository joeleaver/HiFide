import { ReactNode, useCallback, useEffect, useMemo, useRef } from 'react'
import { Button, Divider, Group, Stack } from '@mantine/core'
import { ApiKeysForm } from './ApiKeysForm'
import { useApiKeyManagement } from '../hooks/useApiKeyManagement'

const PROVIDERS = ['openai', 'anthropic', 'gemini', 'fireworks', 'xai', 'openrouter'] as const

type ProviderKey = (typeof PROVIDERS)[number]

type ProviderValidState = Record<string, boolean>

type ApiKeysMap = Record<string, string>

function normalizeKeys(keys?: ApiKeysMap): ApiKeysMap {
  const normalized: ApiKeysMap = {}
  PROVIDERS.forEach((provider) => {
    normalized[provider] = keys?.[provider] ?? ''
  })
  return normalized
}

interface ApiKeysSectionProps {
  initialApiKeys?: ApiKeysMap
  initialProviderValid?: ProviderValidState
  onSaveComplete?: () => Promise<unknown> | void
  children?: ReactNode
}

export function ApiKeysSection({
  initialApiKeys,
  initialProviderValid,
  onSaveComplete,
  children,
}: ApiKeysSectionProps) {
  const { apiKeys, setApiKeys, providerValid, setProviderValid, saving, validating, saveAndValidate } =
    useApiKeyManagement({ autoHydrate: false })

  const lastHydratedKeys = useRef<ApiKeysMap>(normalizeKeys(initialApiKeys))

  useEffect(() => {
    const normalized = normalizeKeys(initialApiKeys)
    lastHydratedKeys.current = normalized
    setApiKeys(normalized)
  }, [initialApiKeys, setApiKeys])

  useEffect(() => {
    setProviderValid(initialProviderValid || {})
  }, [initialProviderValid, setProviderValid])

  const handleChange = useCallback(
    (nextKeys: ApiKeysMap) => {
      setApiKeys(nextKeys)
    },
    [setApiKeys]
  )

  const hasUnsavedChanges = useMemo(() => {
    return PROVIDERS.some((provider: ProviderKey) => {
      const nextValue = apiKeys?.[provider] ?? ''
      const hydratedValue = lastHydratedKeys.current[provider] ?? ''
      return nextValue !== hydratedValue
    })
  }, [apiKeys])

  const handleSave = useCallback(async () => {
    await saveAndValidate()
    lastHydratedKeys.current = normalizeKeys(apiKeys)
    await onSaveComplete?.()
  }, [apiKeys, onSaveComplete, saveAndValidate])

  return (
    <Stack gap="md">
      <ApiKeysForm apiKeys={apiKeys} onChange={handleChange} providerValid={providerValid} showValidation />
      {children}
      <Divider />
      <Group>
        <Button onClick={handleSave} loading={saving || validating} disabled={!hasUnsavedChanges && !saving && !validating}>
          Save & Validate Keys
        </Button>
      </Group>
    </Stack>
  )
}
