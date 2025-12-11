import { create } from 'zustand'
import type { LspLanguageStatusPayload } from '../../shared/lsp'
import { LSP_NOTIFICATION_LANGUAGE_STATUS } from '../../shared/lsp'
import { getBackendClient } from '@/lib/backend/bootstrap'

interface LanguageSupportState {
  languages: Record<string, LspLanguageStatusPayload>
  autoInstall: boolean
  loading: boolean
  error: string | null
  dismissed: Record<string, boolean>
  installingLanguage: string | null
  hydrate: () => Promise<void>
  handleLanguageStatus: (payload: LspLanguageStatusPayload) => void
  requestProvision: (languageId: string, reason: 'auto' | 'user') => Promise<boolean>
  setAutoInstallPreference: (enabled: boolean) => Promise<void>
  dismissLanguage: (languageId: string) => void
  clearDismissedLanguage: (languageId: string) => void
  enableAutoInstall: (languageId: string | null) => Promise<boolean>
}

export const useLanguageSupportStore = create<LanguageSupportState>((set, get) => ({
  languages: {},
  autoInstall: false,
  loading: false,
  error: null,
  dismissed: {},
  installingLanguage: null,
  hydrate: async () => {
    const client = getBackendClient()
    if (!client) return
    set({ loading: true, error: null })
    try {
      if (typeof client.whenReady === 'function') {
        await client.whenReady()
      }
      const response: any = await client.rpc('lsp.languages', {})
      if (!response?.ok) {
        throw new Error(response?.error || 'languages-failed')
      }
      const languagesArray: LspLanguageStatusPayload[] = Array.isArray(response.languages) ? response.languages : []
      const languages = languagesArray.reduce<Record<string, LspLanguageStatusPayload>>((acc, entry) => {
        if (entry?.languageId) {
          acc[entry.languageId] = entry
        }
        return acc
      }, {})
      set({ languages, autoInstall: !!response.autoInstall, loading: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ loading: false, error: message })
    }
  },
  handleLanguageStatus: (payload) => {
    if (!payload?.languageId) return
    set((state) => ({
      languages: { ...state.languages, [payload.languageId]: payload },
    }))
  },
  requestProvision: async (languageId, reason) => {
    const client = getBackendClient()
    if (!client) return false
    set({ installingLanguage: languageId, error: null })
    try {
      const response: any = await client.rpc('lsp.provisionLanguage', { languageId, reason })
      if (!response?.ok) {
        throw new Error(response?.error || 'provision-failed')
      }
      if (response.status) {
        get().handleLanguageStatus(response.status as LspLanguageStatusPayload)
      }
      set((state) => {
        const nextDismissed = { ...state.dismissed }
        if (reason === 'user') {
          delete nextDismissed[languageId]
        }
        return {
          dismissed: nextDismissed,
          installingLanguage: state.installingLanguage === languageId ? null : state.installingLanguage,
        }
      })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set((state) => ({
        error: message,
        installingLanguage: state.installingLanguage === languageId ? null : state.installingLanguage,
      }))
      return false
    }
  },
  setAutoInstallPreference: async (enabled) => {
    const client = getBackendClient()
    if (!client) return
    try {
      const response: any = await client.rpc('lsp.setAutoInstall', { enabled })
      if (!response?.ok) {
        throw new Error(response?.error || 'auto-install-failed')
      }
      set({ autoInstall: enabled })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ error: message })
      throw error
    }
  },
  dismissLanguage: (languageId) => {
    if (!languageId) return
    set((state) => ({ dismissed: { ...state.dismissed, [languageId]: true } }))
  },
  clearDismissedLanguage: (languageId) => {
    if (!languageId) return
    set((state) => {
      if (!state.dismissed[languageId]) return state
      const next = { ...state.dismissed }
      delete next[languageId]
      return { ...state, dismissed: next }
    })
  },
  enableAutoInstall: async (languageId) => {
    try {
      await get().setAutoInstallPreference(true)
      if (languageId) {
        return await get().requestProvision(languageId, 'user')
      }
      return true
    } catch (error) {
      return false
    }
  },
}))

let eventsBound = false
export function initLanguageSupportEvents(): void {
  if (eventsBound) return
  const client = getBackendClient()
  if (!client) return
  eventsBound = true

  const triggerHydration = () => {
    void (async () => {
      try {
        if (typeof client.whenReady === 'function') {
          await client.whenReady()
        }
        await useLanguageSupportStore.getState().hydrate()
      } catch (error) {
        console.warn('[language-support] Failed to hydrate language support', error)
      }
    })()
  }

  client.subscribe(LSP_NOTIFICATION_LANGUAGE_STATUS, (payload: LspLanguageStatusPayload) => {
    try {
      useLanguageSupportStore.getState().handleLanguageStatus(payload)
    } catch (error) {
      console.warn('[language-support] Failed to handle status update', error)
    }
  })

  client.subscribe('workspace.attached', () => {
    triggerHydration()
  })

  triggerHydration()
}
