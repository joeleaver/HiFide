import { create } from 'zustand'
import { getBackendClient } from '../lib/backend/bootstrap'
import { useChatTimeline } from './chatTimeline'
import { useFlowRuntime, refreshFlowRuntimeStatusWithRetry } from './flowRuntime'

const SESSION_USAGE_DEBUG_FROM_ENV = import.meta.env?.VITE_SESSION_USAGE_DEBUG === '1'

const shouldLogSessionUsageDebug = (): boolean => {
  if (SESSION_USAGE_DEBUG_FROM_ENV) return true
  if (typeof window !== 'undefined' && '__HF_SESSION_USAGE_DEBUG' in window) {
    return Boolean((window as unknown as { __HF_SESSION_USAGE_DEBUG?: boolean }).__HF_SESSION_USAGE_DEBUG)
  }
  return false
}

const logSessionUsageDebug = (...args: unknown[]): void => {
  if (!shouldLogSessionUsageDebug()) return
  console.debug(...args)
}

const summarizeUsagePayload = (payload: any) => ({
  tokenTotals: payload?.tokenUsage?.total ?? null,
  totalCost: payload?.costs?.totalCost ?? null,
  currency: payload?.costs?.currency ?? null,
  requestsLogLength: Array.isArray(payload?.requestsLog) ? payload.requestsLog.length : 0,
})


export interface SessionSummary { id: string; title: string }
export interface ProviderOption { value: string; label: string }

interface SessionUsageState {
  tokenUsage?: any
  costs?: any
  requestsLog?: any[]
}

interface SessionMetaState {
  executedFlowId: string
  providerId: string
  modelId: string
}

export interface SessionUiState extends SessionUsageState, SessionMetaState {
  sessions: SessionSummary[]
  currentId: string | null
  providerValid: Record<string, boolean>
  modelsByProvider: Record<string, ProviderOption[]>
  flows: Array<{ id: string; name: string; library?: string }>

  // Hydration flags
  isHydratingMeta: boolean
  isHydratingUsage: boolean
  // Whether we've received the first sessions list (even if empty)
  hasHydratedList: boolean

  // Debug: whether event subscriptions were attached with a live client
  eventsInited: boolean

  // Actions (thin wrappers; components call these, logic lives here)
  selectSession: (id: string) => Promise<void>
  newSession: () => Promise<void>
  setExecutedFlow: (flowId: string) => Promise<void>
  setProviderModel: (providerId: string, modelId: string) => Promise<void>

  // Internal setters used by event handlers
  __setSessions: (list: SessionSummary[], currentId: string | null) => void
  __setSelected: (id: string | null) => void
  __setUsage: (usage?: any, costs?: any, requestsLog?: any[]) => void
  __setMeta: (meta: Partial<SessionMetaState>) => void
  __setSettings: (providerValid: Record<string, boolean>, modelsByProvider: Record<string, ProviderOption[]>) => void
  __setFlows: (flows: Array<{ id: string; name: string; library?: string }>) => void
  __reset: () => void
}

function createSessionUiStore() {
  return create<SessionUiState>((set, get) => ({
    sessions: [],
    currentId: null,
    executedFlowId: '',
    providerId: '',
    modelId: '',
    providerValid: {},
    modelsByProvider: {},
    flows: [],
    isHydratingMeta: false,
    isHydratingUsage: false,
    hasHydratedList: false,
    eventsInited: false,

    selectSession: async (id) => {
      const client = getBackendClient()
      if (!client) return
      const prev = get().currentId
      // Optimistically update selected session for immediate UI feedback (checkmark)
      try { useSessionUi.getState().__setSelected(id) } catch {}
      // Ensure runtime scoping follows the newly selected session immediately
      try { useFlowRuntime.getState().setSessionScope(id) } catch {}
      // Immediately reset flow runtime to follow the newly selected session
      try { useFlowRuntime.getState().reset() } catch {}

      try {
        await client.rpc('session.select', { id })
        // Backend will emit session.selected, session.meta.changed, session.usage.changed, and session.timeline.snapshot events
        // Seed the flow runtime status shortly after switch
        try { await fetchAndApplyCurrentSessionMeta('session.select') } catch {}
        try { await refreshFlowRuntimeStatusWithRetry([150, 300, 600]) } catch {}
      } catch (e) {
        // Roll back selection on failure
        try { useSessionUi.getState().__setSelected(prev || null) } catch {}
        console.warn('[sessionUi] selectSession failed:', e)
      }
    },
    newSession: async () => {
      const client = getBackendClient()
      if (!client) return
      try {
        const res = await client.rpc('session.new', {})
        if (res?.ok) {
          const sessions = Array.isArray(res.sessions) ? res.sessions : []
          const curId = res.currentId || res.id || null
          if (sessions.length) {
            try { useSessionUi.getState().__setSessions(sessions, curId) } catch {}
            // Scope runtime to the new session immediately
            try { useFlowRuntime.getState().setSessionScope(curId) } catch {}
          }
          if (curId) {
            try { useSessionUi.getState().__setSelected(curId) } catch {}
            try { useFlowRuntime.getState().reset() } catch {}
            // Clear timeline for new session
            try { useChatTimeline.getState().clear() } catch {}
            // Seed runtime status shortly after new session creation
            try { await refreshFlowRuntimeStatusWithRetry([150, 300, 600]) } catch {}
          }
          try { await fetchAndApplyCurrentSessionMeta('session.new') } catch {}
        }
      } catch {}
    },
    setExecutedFlow: async (flowId) => {
      const sid = get().currentId
      if (!sid || !flowId) return
      try {
        await getBackendClient()?.rpc('session.setExecutedFlow', { sessionId: sid, flowId })
        set({ executedFlowId: flowId })
      } catch {}
    },
    setProviderModel: async (providerId, modelId) => {
      const sid = get().currentId
      if (!sid) return
      try {
        await getBackendClient()?.rpc('session.setProviderModel', { sessionId: sid, providerId, modelId })
        set({ providerId, modelId })
      } catch {}
    },

    __setSessions: (list, currentId) => set({ sessions: list.slice(), currentId, hasHydratedList: true }),
    __setSelected: (id) => set((s) => ({ currentId: id, hasHydratedList: s.hasHydratedList || !!id })),
    __setUsage: (tokenUsage, costs, requestsLog) => {
      // Lightweight guard to avoid rerender storms: only update when values actually change.
      const prev = get()
      const sameUsage = prev.tokenUsage === tokenUsage
      const sameCosts = prev.costs === costs
      const sameLog = prev.requestsLog === requestsLog

      if (sameUsage && sameCosts && sameLog) {
        return
      }

      set({ tokenUsage, costs, requestsLog })
    },
    __setMeta: (meta) => set((s) => ({ ...s, ...meta })),
    __setSettings: (providerValid, modelsByProvider) => {
      set({ providerValid, modelsByProvider })
      try {
        const snapshot = get()
        const modelCounts = Object.fromEntries(
          Object.entries(snapshot.modelsByProvider || {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : -1]),
        )
        console.log('[sessionUi] __setSettings applied', {
          providerValid: snapshot.providerValid,
          modelCounts,
        })
      } catch {}
    },
    __setFlows: (flows) => set({ flows }),
    __reset: () => set({
      sessions: [],
      currentId: null,
      executedFlowId: '',
      providerId: '',
      modelId: '',
      tokenUsage: undefined,
      costs: undefined,
      requestsLog: [],
      flows: [],
      isHydratingMeta: false,
      isHydratingUsage: false,
      hasHydratedList: false,
    })
  }))
}

// HMR reuse pattern like other stores
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hotData: any = (import.meta as any).hot?.data || {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const __sessionUiStore: any = hotData.sessionUiStore || createSessionUiStore()
export const useSessionUi = __sessionUiStore

if ((import.meta as any).hot) {
  (import.meta as any).hot.dispose((data: any) => { data.sessionUiStore = __sessionUiStore })
}

async function fetchAndApplyCurrentSessionMeta(reason = 'unknown'): Promise<void> {
  const client = getBackendClient()
  if (!client) {
    console.warn('[sessionUi] fetchCurrentSessionMeta skipped (no client):', reason)
    return
  }
  try {
    const res = await client.rpc('session.getCurrentMeta', {})
    if (!res?.ok) {
      console.warn('[sessionUi] fetchCurrentSessionMeta failed:', res?.error)
      return
    }
    const meta = res.meta
    if (!meta) {
      useSessionUi.getState().__setMeta({ executedFlowId: '', providerId: '', modelId: '' })
      return
    }
    const executedFlowId = meta.executedFlowId || meta.lastUsedFlowId || ''
    const providerId = meta.providerId || meta.provider || ''
    const modelId = meta.modelId || meta.model || ''
    useSessionUi.getState().__setMeta({ executedFlowId, providerId, modelId })
  } catch (e) {
    console.warn('[sessionUi] fetchCurrentSessionMeta threw:', e)
  }
}

export function initSessionUiEvents(): void {
  const client = getBackendClient()
  if (!client) return

  useSessionUi.setState({ eventsInited: true })

  // Session selection changes - just update UI state (meta/usage come from snapshot or events)
  client.subscribe('session.selected', (p: any) => {
    const id = p?.id || null
    useSessionUi.getState().__setSelected(id)
    useFlowRuntime.getState().reset()
    useFlowRuntime.getState().setSessionScope(id)
    void fetchAndApplyCurrentSessionMeta('session.selected event')
    void refreshFlowRuntimeStatusWithRetry([150, 300, 600])
  })

  // Ensure there is a selected session after hydration (new window -> open workspace)
  const ensureSelectionIfNone = async () => {
    try {
      const state = useSessionUi.getState()
      if (state.currentId || state.sessions.length === 0) return

      // Preemptively mark timeline as hydrating to avoid overlay gap before server snapshot arrives
      try { useChatTimeline.setState({ isHydrating: true }) } catch {}
      try { useChatTimeline.getState().clear() } catch {}

      // Use timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('session.select timeout')), 5000)
      )
      await Promise.race([
        client.rpc('session.select', { id: state.sessions[0].id }),
        timeoutPromise
      ])
    } catch (e) {
      console.warn('[sessionUi] ensureSelectionIfNone failed:', e)
      // Ensure timeline hydration flag is cleared even on timeout
      try { useChatTimeline.setState({ isHydrating: false }) } catch {}
    }
  }

  // All data now comes via workspace.snapshot event (handled by hydration store)
  // No need for manual hydration - just ensure a session is selected if none exists
  client.subscribe('workspace.ready', async (_p: any) => {
    console.log('[sessionUi] workspace.ready received, ensuring session selection')
    try { await ensureSelectionIfNone() } catch (e) {
      console.error('[sessionUi] ensureSelectionIfNone error', e)
    }
  })

  client.subscribe('settings.models.changed', (p: any) => {
    console.log('[sessionUi] settings.models.changed received, updating provider/models snapshot')
    try {
      useSessionUi.getState().__setSettings(p?.providerValid || {}, p?.modelsByProvider || {})
    } catch (e) {
      console.warn('[sessionUi] settings.models.changed: __setSettings failed', e)
    }
  })

  client.subscribe('session.list.changed', (p: any) => {
    const list = Array.isArray(p?.sessions) ? p.sessions as SessionSummary[] : []
    const currentId = (p?.currentId ?? null) as string | null
    try { useSessionUi.getState().__setSessions(list, currentId) } catch {}
  })

  client.subscribe('session.usage.changed', (p: any) => {
    logSessionUsageDebug('[sessionUi] Received session.usage.changed event summary:', summarizeUsagePayload(p))
    try {
      const st = useSessionUi.getState()
      logSessionUsageDebug('[sessionUi] Calling __setUsage with summary:', summarizeUsagePayload(p))
      st.__setUsage(p.tokenUsage, p.costs, p.requestsLog)
      logSessionUsageDebug('[sessionUi] __setUsage completed successfully')
    } catch (e) {
      console.error('[sessionUi] Error in __setUsage:', e)
    }
  })
}

export async function hydrateSessionUiSettingsAndFlows(): Promise<void> {
  const client = getBackendClient()
  if (!client) {
    console.log('[sessionUi] hydrateSessionUiSettingsAndFlows: no backend client')
    return
  }

  try {
    console.log('[sessionUi] hydrateSessionUiSettingsAndFlows: requesting settings.get + flowEditor.getTemplates + flowEditor.getGraph + kanban.getBoard')

    // Pre-fetch flow editor graph and kanban board to avoid loading screens
    const { useFlowEditor } = await import('./flowEditor')
    const { useKanban } = await import('./kanban')

    const settled = await Promise.allSettled([
      client.rpc('settings.get', {}),
      client.rpc('flowEditor.getTemplates', {}),
      useFlowEditor.getState().fetchGraph(),
      useKanban.getState().hydrateBoard(),
    ])

    const getVal = (idx: number) => (settled[idx] && (settled[idx] as PromiseSettledResult<any>).status === 'fulfilled')
      ? (settled[idx] as PromiseFulfilledResult<any>).value
      : null

    const settingsRes = getVal(0)
    const templates = getVal(1)
    // Graph and kanban are already set in their respective stores via fetchGraph() and hydrateBoard()

    let providerValidMap: Record<string, boolean> = settingsRes?.providerValid || {}
    const modelsMap = settingsRes?.modelsByProvider || {}
    const modelCounts = Object.fromEntries(
      Object.entries(modelsMap).map(([k, v]) => [k, Array.isArray(v) ? v.length : -1]),
    )

    // Derive key presence per known provider; ignore any weird extra keys in settingsApiKeys
    const rawKeys = (settingsRes?.settingsApiKeys || {}) as Record<string, unknown>
    const hasKey = {
      openai: !!String(rawKeys.openai ?? '').trim(),
      anthropic: !!String(rawKeys.anthropic ?? '').trim(),
      gemini: !!String(rawKeys.gemini ?? '').trim(),
      fireworks: !!String(rawKeys.fireworks ?? '').trim(),
      xai: !!String((rawKeys as any).xai ?? '').trim(),
    }

    // If backend says all providers are invalid but we clearly have keys, fall back to treating
    // key presence as “valid” so the UI can still trigger model refresh per provider.
    const anyValidFromBackend = Object.values(providerValidMap || {}).some(Boolean)
    const anyKeysPresent = Object.values(hasKey).some(Boolean)
    if (!anyValidFromBackend && anyKeysPresent) {
      providerValidMap = { ...hasKey }
    }

    console.log('[sessionUi] hydrateSessionUiSettingsAndFlows: settings.get ->', {
      ok: settingsRes?.ok,
      providerKeys: Object.keys(providerValidMap),
      modelProviderKeys: Object.keys(modelsMap),
      providerValid: providerValidMap,
      hasKey,
      modelCounts,
    })
    console.log('[sessionUi] hydrateSessionUiSettingsAndFlows: flowEditor.getTemplates ->', {
      ok: templates?.ok,
      templateCount: Array.isArray(templates?.templates) ? templates.templates.length : null,
    })

    if (settingsRes?.ok) {
      try {
        useSessionUi.getState().__setSettings(providerValidMap, settingsRes.modelsByProvider || {})
      } catch (e) {
        console.warn('[sessionUi] hydrateSessionUiSettingsAndFlows: __setSettings failed', e)
      }
    }

    // Proactively fetch models for valid providers on first hydrate if none are loaded yet.
    try {
      const anyValid = Object.values(providerValidMap || {}).some(Boolean)
      const totalLoaded = Object.values(modelCounts || {}).reduce(
        (acc: number, n: any) => acc + (typeof n === 'number' && n > 0 ? n : 0),
        0,
      )

      if (anyValid && totalLoaded === 0) {
        const providersToRefresh = (['openai', 'anthropic', 'gemini', 'fireworks', 'xai'] as const)
          .filter((pid) => (providerValidMap as any)[pid])
        console.log('[sessionUi] hydrateSessionUiSettingsAndFlows: prefetching models for', providersToRefresh)

        await Promise.allSettled(
          providersToRefresh.map(async (pid) => {
            try {
              const res: any = await client.rpc('provider.refreshModels', { provider: pid })
              if (res?.ok) {
                const cur = useSessionUi.getState()
                const curModels = Array.isArray(res.models) ? res.models : []
                const nextMap = { ...(cur.modelsByProvider || {}), [pid]: curModels }
                useSessionUi.getState().__setSettings(cur.providerValid || {}, nextMap)
              }
            } catch (e) {
              console.warn('[sessionUi] hydrateSessionUiSettingsAndFlows: prefetch failed for', pid, e)
            }
          }),
        )
      }
    } catch (e) {
      console.warn('[sessionUi] hydrateSessionUiSettingsAndFlows: prefetch block failed', e)
    }

    if (templates?.ok) {
      try {
        const mapped = (templates.templates || [])
          .map((x: any) => ({
            id: String(x.id || x.name || ''),
            name: String(x.name || x.id || ''),
            library: typeof x.library === 'string' ? x.library : undefined,
          }))
          .filter((f: any) => f.id)
        console.log('[sessionUi] hydrateSessionUiSettingsAndFlows: mapped flows', {
          count: mapped.length,
          ids: mapped.map((m: any) => m.id),
        })
        useSessionUi.getState().__setFlows(mapped)
      } catch (e) {
        console.warn('[sessionUi] hydrateSessionUiSettingsAndFlows: __setFlows failed', e)
      }
    }
  } catch (e) {
    console.error('[sessionUi] hydrateSessionUiSettingsAndFlows: error', e)
  }
}

