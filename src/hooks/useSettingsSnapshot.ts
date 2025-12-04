import { useCallback, useEffect, useState } from 'react'
import { getBackendClient } from '../lib/backend/bootstrap'
import type { BackendClient } from '../lib/backend/client'
import type { SettingsSnapshot, SettingsSnapshotResponse } from '../../electron/types/settings'
import type { ModelOption, PricingConfig } from '../../electron/store/types'

type ReadyAwareClient = BackendClient & { whenReady?: (timeout?: number) => Promise<void> }

type ModelsChangedPayload = {
  providerValid?: Record<string, boolean>
  modelsByProvider?: Record<string, ModelOption[]>
  fireworksAllowedModels?: string[]
  defaultModels?: Record<string, string | undefined>
}

type PricingChangedPayload = {
  pricingConfig?: PricingConfig
  defaultPricingConfig?: PricingConfig
}

type AppBootPayload = {
  startupMessage?: string | null
}

type KeysChangedPayload = {
  settingsApiKeys?: Record<string, string>
}

function stripOk({ ok: _unused, ...rest }: SettingsSnapshotResponse): SettingsSnapshot {
  void _unused
  return rest as SettingsSnapshot
}

async function waitForBackendReady(client: BackendClient | null): Promise<void> {
  if (!client) return
  const readyClient = client as ReadyAwareClient
  await readyClient.whenReady?.(5000).catch(() => {})
}

export function useSettingsSnapshot() {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<SettingsSnapshot | null> => {
    const client = getBackendClient()
    if (!client) {
      setError('Backend client unavailable')
      setLoading(false)
      return null
    }

    setLoading(true)
    try {
      await waitForBackendReady(client)
      const res = await client.rpc<SettingsSnapshotResponse>('settings.get', {})
      if (res?.ok) {
        const data = stripOk(res)
        setSnapshot(data)
        setError(null)
        return data
      }
      throw new Error('settings.get returned an error response')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const mergeSnapshot = useCallback(
    (update: Partial<SettingsSnapshot> | ((prev: SettingsSnapshot) => SettingsSnapshot)) => {
      setSnapshot((prev) => {
        if (!prev) return prev
        if (typeof update === 'function') {
          return update(prev)
        }
        return { ...prev, ...update }
      })
    },
    []
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const data = await refresh()
      if (cancelled || !data) return
    })()
    return () => { cancelled = true }
  }, [refresh])

  useEffect(() => {
    const client = getBackendClient()
    if (!client) return

    const unsubModels = client.subscribe('settings.models.changed', (payload: ModelsChangedPayload) => {
      setSnapshot((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          providerValid: payload?.providerValid || prev.providerValid,
          modelsByProvider: payload?.modelsByProvider || prev.modelsByProvider,
          fireworksAllowedModels: Array.isArray(payload?.fireworksAllowedModels)
            ? payload.fireworksAllowedModels
            : prev.fireworksAllowedModels,
          defaultModels: payload?.defaultModels || prev.defaultModels,
        }
      })
    })

    const unsubPricing = client.subscribe('settings.pricing.changed', (payload: PricingChangedPayload) => {
      setSnapshot((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          pricingConfig: payload?.pricingConfig || prev.pricingConfig,
          defaultPricingConfig: payload?.defaultPricingConfig || prev.defaultPricingConfig,
        }
      })
    })

    const unsubStartup = client.subscribe('app.boot.changed', (payload: AppBootPayload) => {
      setSnapshot((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          startupMessage: payload?.startupMessage ?? prev.startupMessage,
        }
      })
    })

    const unsubKeys = client.subscribe('settings.keys.changed', (payload: KeysChangedPayload) => {
      setSnapshot((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          settingsApiKeys: payload?.settingsApiKeys || prev.settingsApiKeys,
        }
      })
    })

    return () => {
      unsubModels?.()
      unsubPricing?.()
      unsubStartup?.()
      unsubKeys?.()
    }
  }, [])

  return { snapshot, loading, error, refresh, mergeSnapshot }
}
