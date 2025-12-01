import { useState, useEffect } from 'react'
import { getBackendClient } from '../lib/backend/bootstrap'
import { notifications } from '@mantine/notifications'

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

  const hydrate = async () => {
    const client = getBackendClient()
    if (!client) return

    setState((prev) => ({ ...prev, loading: true }))
    try {
      await (client as any).whenReady?.(5000).catch(() => {})
      const res: any = await client.rpc('settings.get', {})
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
      await (client as any).whenReady?.(5000).catch(() => {})

      // Save keys
      await client.rpc('settings.setApiKeys', { apiKeys: state.apiKeys })
      await client.rpc('settings.saveKeys', {})

      // Validate keys
      const res: any = await client.rpc('settings.validateKeys', {})

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
      await (client as any).whenReady?.(5000).catch(() => {})
      const res: any = await client.rpc('settings.validateKeys', {})

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
    hydrate,
    saveAndValidate,
    validateOnly,
  }
}

