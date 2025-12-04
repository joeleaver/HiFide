import { useState, useEffect } from 'react'
import { getBackendClient } from '../lib/backend/bootstrap'
import { notifications } from '@mantine/notifications'
import type { BackendClient } from '../lib/backend/client'
import type { SettingsSnapshotResponse } from '../../electron/types/settings'

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


async function waitForBackendReady(client: BackendClient | null): Promise<void> {
  if (!client) return
  const readyClient = client as ReadyAwareClient
  await readyClient.whenReady?.(5000).catch(() => {})
}

export function useApiKeyManagement(autoHydrate = true) {
  const [state, setState] = useState<ApiKeyManagementState>({
    apiKeys: {},
    providerValid: {},
    loading: false,
    saving: false,
    validating: false,
  })

  const setApiKeys = (apiKeys: Record<string, string>) => {
    setState((prev) => ({ ...prev, apiKeys }))
  }

  const setProviderValid = (providerValid: Record<string, boolean>) => {
    setState((prev) => ({ ...prev, providerValid }))
  }

  const hydrate = async () => {
    const client = getBackendClient()
    if (!client) return

    setState((prev) => ({ ...prev, loading: true }))
    try {
      await waitForBackendReady(client)
      const res = await client.rpc<SettingsSnapshotResponse>('settings.get', {})
      if (res?.ok) {
        setState((prev) => ({
          ...prev,
          apiKeys: res.settingsApiKeys || {},
          providerValid: res.providerValid || {},
          loading: false,
        }))
      }
    } catch (e) {
      console.error('[useApiKeyManagement] hydrate failed:', e)
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
      await client.rpc('settings.setApiKeys', { apiKeys: state.apiKeys })
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
    setApiKeys,
    setProviderValid,
    hydrate,
    saveAndValidate,
    validateOnly,
  }
}
