import { create } from 'zustand'
import { getBackendClient } from '@/lib/backend/bootstrap'

interface AppBootStore {
  appBootstrapping: boolean
  startupMessage: string | null
  
  setAppBootstrapping: (bootstrapping: boolean) => void
  setStartupMessage: (message: string | null) => void
  hydrateBootStatus: () => Promise<void>
}

export const useAppBoot = create<AppBootStore>((set) => ({
  appBootstrapping: true,  // Start as true to show loading overlay
  startupMessage: 'Starting…',
  
  setAppBootstrapping: (bootstrapping) => set({ appBootstrapping: bootstrapping }),
  setStartupMessage: (message) => set({ startupMessage: message }),
  
  hydrateBootStatus: async () => {
    const client = getBackendClient()
    if (!client) {
      set({ startupMessage: 'Connecting to backend…' })
      return
    }

    try {
      // Wait for client to be ready
      await (client as any).whenReady?.(7000)

      const res: any = await client.rpc('app.getBootStatus', {})
      if (res?.ok) {
        set({
          appBootstrapping: !!res.appBootstrapping,
          startupMessage: res.startupMessage || null
        })
      }
    } catch {
      set({ startupMessage: 'Failed to connect to backend' })
    }
  }
}))

export function initAppBootEvents(): void {
  const client = getBackendClient()
  if (!client) return

  // Boot status changed
  client.subscribe('app.boot.changed', (p: any) => {
    console.log('[appBoot] Received app.boot.changed:', p)
    useAppBoot.setState({
      appBootstrapping: !!p?.appBootstrapping,
      startupMessage: p?.startupMessage || null
    })
  })
}

