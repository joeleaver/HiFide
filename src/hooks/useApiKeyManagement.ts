import { useState, useEffect, useCallback } from 'react'
import { getBackendClient } from '../lib/backend/bootstrap'
import { notifications } from '@mantine/notifications'
import type { BackendClient } from '../lib/backend/client'
import type { SettingsSnapshotResponse } from '../../electron/types/settings'

type ReadyAwareClient = BackendClient & { whenReady?: (timeout?: number) => Promise<void> }

interface ApiKeyManagementState {
  apiKeys: Record<string, string>
  providerValid: Record<string, boolean>
  loading: boolean
  saving: boolean
  validating: boolean
}

interface SaveResult {
  ok: boolean
  failures: string[]
}

interface ValidateKeysResult {
  ok: boolean
  failures?: string[]
}

interface UseApiKeyManagementOptions {
  autoHydrate?: boolean
  apiKeys?: Record<string, string>
  onApiKeysChange?: (keys: Record<string, string>) => void
  providerValid?: Record<string, boolean>
  onProviderValidChange?: (state: Record<string, boolean>) => void
}


async function waitForBackendReady(client: BackendClient | null): Promise<void> {
  if (!client) return
  const readyClient = client as ReadyAwareClient
  await readyClient.whenReady?.(5000).catch(() => {})
}

type UseApiKeyManagementArg = boolean | UseApiKeyManagementOptions | undefined

export function useApiKeyManagement(arg: UseApiKeyManagementArg = true) {
  const options: UseApiKeyManagementOptions =
    typeof arg === 'boolean' ? { autoHydrate: arg } : arg || {}
  const autoHydrate = options.autoHydrate ?? true

  const [state, setState] = useState<ApiKeyManagementState>({
    apiKeys: {},
    providerValid: {},
    loading: false,
    saving: false,
    validating: false,
  })

  const isApiKeysControlled = options.apiKeys !== undefined && typeof options.onApiKeysChange === 'function'
  const isProviderValidControlled =
    options.providerValid !== undefined && typeof options.onProviderValidChange === 'function'

  const currentApiKeys = (isApiKeysControlled ? options.apiKeys : state.apiKeys) || {}
  const currentProviderValid =
    (isProviderValidControlled ? options.providerValid : state.providerValid) || {}

  const onApiKeysChange = options.onApiKeysChange
  const onProviderValidChange = options.onProviderValidChange

  const setApiKeys = useCallback(
    (apiKeys: Record<string, string>) => {
      if (isApiKeysControlled) {
        onApiKeysChange?.(apiKeys)
        return
      }
      setState((prev) => ({ ...prev, apiKeys }))
    },
    [isApiKeysControlled, onApiKeysChange]
  )

  const setProviderValid = useCallback(
    (providerValid: Record<string, boolean>) => {
      if (isProviderValidControlled) {
        onProviderValidChange?.(providerValid)
        return
      }
      setState((prev) => ({ ...prev, providerValid }))
    },
    [isProviderValidControlled, onProviderValidChange]
  )

  const hydrate = async () => {
    const client = getBackendClient()
    if (!client) return

    setState((prev) => ({ ...prev, loading: true }))
    try {
      await waitForBackendReady(client)
      const res = await client.rpc<SettingsSnapshotResponse>('settings.get', {})
      if (res?.ok) {
        setApiKeys(res.settingsApiKeys || {})
        setProviderValid(res.providerValid || {})
      }
    } catch (e) {
      console.error('[useApiKeyManagement] hydrate failed:', e)
    } finally {
      setState((prev) => ({ ...prev, loading: false }))
    }
  }

  const saveAndValidate = async (): Promise<SaveResult> => {
    const client = getBackendClient()
    if (!client) {
      notifications.show({
        color: 'red',
        title: 'Error',
        message: 'Backend client not available',
      })
      return { ok: false, failures: ['Backend not available'] }
    }

    setState((prev) => ({ ...prev, saving: true, validating: true }))
    try {
      await waitForBackendReady(client)
      await client.rpc('settings.setApiKeys', { apiKeys: currentApiKeys })
      await client.rpc('settings.saveKeys', {})

      const res = await client.rpc<ValidateKeysResult>('settings.validateKeys', {})

      // Refresh to get updated providerValid
      await hydrate()

      setState((prev) => ({ ...prev, saving: false, validating: false }))

      if (res?.ok) {
        const failures: string[] = res.failures || []
        if (failures.length === 0) {
          notifications.show({
            color: 'green',
            title: 'Success',
            message: 'API keys saved and validated',
          })
        } else {
          notifications.show({
            color: 'yellow',
            title: 'Partial Success',
            message: `Saved, but some providers failed: ${failures.join(', ')}`,
          })
        }
        return { ok: true, failures }
      } else {
        notifications.show({
          color: 'red',
          title: 'Validation Failed',
          message: 'Failed to validate API keys',
        })
        return { ok: false, failures: [] }
      }
    } catch (e) {
      setState((prev) => ({ ...prev, saving: false, validating: false }))
      notifications.show({
        color: 'red',
        title: 'Error',
        message: String(e),
      })
      return { ok: false, failures: [String(e)] }
    }
  }

  const validateOnly = async (): Promise<SaveResult> => {
    const client = getBackendClient()
    if (!client) {
      notifications.show({
        color: 'red',
        title: 'Error',
        message: 'Backend client not available',
      })
      return { ok: false, failures: ['Backend not available'] }
    }

    setState((prev) => ({ ...prev, validating: true }))
    try {
      await waitForBackendReady(client)
      const res = await client.rpc<ValidateKeysResult>('settings.validateKeys', {})

      // Refresh to get updated providerValid
      await hydrate()

      setState((prev) => ({ ...prev, validating: false }))

      if (res?.ok) {
        const failures: string[] = res.failures || []
        if (failures.length === 0) {
          notifications.show({
            color: 'green',
            title: 'Keys Valid',
            message: 'All configured providers validated',
          })
        } else {
          notifications.show({
            color: 'yellow',
            title: 'Some Providers Failed',
            message: failures.join(', '),
          })
        }
        return { ok: true, failures }
      } else {
        notifications.show({
          color: 'red',
          title: 'Validation Failed',
          message: 'Failed to validate API keys',
        })
        return { ok: false, failures: [] }
      }
    } catch (e) {
      setState((prev) => ({ ...prev, validating: false }))
      notifications.show({
        color: 'red',
        title: 'Error',
        message: String(e),
      })
      return { ok: false, failures: [String(e)] }
    }
  }

  useEffect(() => {
    if (autoHydrate) {
      hydrate()
    }
  }, [autoHydrate])

  return {
    ...state,
    apiKeys: currentApiKeys,
    providerValid: currentProviderValid,
    setApiKeys,
    setProviderValid,
    hydrate,
    saveAndValidate,
    validateOnly,
  }
}
