import { create } from 'zustand'
import { getBackendClient } from '../lib/backend/bootstrap'
import { useChatTimeline } from './chatTimeline'
import { useFlowRuntime, refreshFlowRuntimeStatusWithRetry } from './flowRuntime'
import { useBackendBinding } from './binding'


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
      } catch (e) {
        // Roll back selection on failure
        try { useSessionUi.getState().__setSelected(prev || null) } catch {}
        return
      }
      // Proactively hydrate timeline and meta to avoid races with WS notifications
      // Use timeout to prevent hanging if RPC fails
      const RPC_TIMEOUT = 5000
      const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> => {
        return Promise.race([
          promise,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
        ])
      }

      try {
        set({ isHydratingMeta: true, isHydratingUsage: true })
        const [meta, usage, snap] = await Promise.all([
          withTimeout(client.rpc('session.getCurrentMeta', {}), RPC_TIMEOUT),
          withTimeout(client.rpc('session.getUsageStrict', {}), RPC_TIMEOUT),
          withTimeout(client.rpc('session.getCurrentStrict', {}), RPC_TIMEOUT),
        ])
        if (meta?.ok) {
          useSessionUi.getState().__setMeta({
            executedFlowId: meta.lastUsedFlow || '',
            providerId: meta.providerId || '',
            modelId: meta.modelId || '',
          })
        }
        if (usage?.ok) {
          useSessionUi.getState().__setUsage(usage.tokenUsage, usage.costs, Array.isArray(usage.requestsLog) ? usage.requestsLog : [])
        }
        if (snap && snap.id === id) {
          const items = Array.isArray(snap.items) ? snap.items : []
          try { useChatTimeline.getState().hydrateFromSession(items) } catch {}
        }
      } catch (e) {
        console.warn('[sessionUi] selectSession hydration error (continuing):', e)
      } finally {
        set({ isHydratingMeta: false, isHydratingUsage: false })
      }
      // Seed the flow runtime status shortly after switch (snapshots waiting/running if already active)
      try { await refreshFlowRuntimeStatusWithRetry([150, 300, 600]) } catch {}

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
            // Hydrate meta/usage/timeline proactively
            try {
              useSessionUi.setState({ isHydratingMeta: true, isHydratingUsage: true })
              try { useChatTimeline.setState({ isHydrating: true }) } catch {}
              const [meta, usage, snap] = await Promise.all([
                client.rpc('session.getCurrentMeta', {}),
                client.rpc('session.getUsageStrict', {}),
                client.rpc('session.getCurrentStrict', {}),
              ])
              if (meta?.ok) {
                useSessionUi.getState().__setMeta({
                  executedFlowId: meta.lastUsedFlow || '',
                  providerId: meta.providerId || '',
                  modelId: meta.modelId || '',
                })
              }
              if (usage?.ok) {
                useSessionUi.getState().__setUsage(usage.tokenUsage, usage.costs, Array.isArray(usage.requestsLog) ? usage.requestsLog : [])
              }
              if (snap && snap.id === curId) {
                const items = Array.isArray(snap.items) ? snap.items : []
                try { useChatTimeline.getState().hydrateFromSession(items) } catch {}
              }
            } finally {
              useSessionUi.setState({ isHydratingMeta: false, isHydratingUsage: false })
            }
              // Seed runtime status shortly after new session creation
              try { await refreshFlowRuntimeStatusWithRetry([150, 300, 600]) } catch {}

          }
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
    __setUsage: (tokenUsage, costs, requestsLog) => set({ tokenUsage, costs, requestsLog }),
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

export function initSessionUiEvents(): void {
  const client = getBackendClient()
  if (!client) return

  useSessionUi.setState({ eventsInited: true })

  // Session selection changes
  client.subscribe('session.selected', (p: any) => {
    const id = p?.id || null
    useSessionUi.getState().__setSelected(id)
    useFlowRuntime.getState().reset()
    useFlowRuntime.getState().setSessionScope(id)
    void refreshFlowRuntimeStatusWithRetry([150, 300, 600])

    // Only fetch meta/usage here; timeline snapshot will arrive via 'session.timeline.snapshot'
    // Use timeout to prevent infinite hangs
    const RPC_TIMEOUT = 5000
    const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> => {
      return Promise.race([
        promise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
      ])
    }

    setTimeout(async () => {
      try {
        console.log('[sessionUi] session.selected: fetching meta/usage')
        useSessionUi.setState({ isHydratingMeta: true, isHydratingUsage: true })
        const [meta, usage] = await Promise.all([
          withTimeout(client.rpc('session.getCurrentMeta', {}), RPC_TIMEOUT),
          withTimeout(client.rpc('session.getUsageStrict', {}), RPC_TIMEOUT),
        ])
        if (meta?.ok) {
          useSessionUi.getState().__setMeta({
            executedFlowId: meta.lastUsedFlow || '',
            providerId: meta.providerId || '',
            modelId: meta.modelId || '',
          })
        }
        if (usage?.ok) {
          useSessionUi.getState().__setUsage(usage.tokenUsage, usage.costs, Array.isArray(usage.requestsLog) ? usage.requestsLog : [])
        }
        console.log('[sessionUi] session.selected: meta/usage fetch complete')
      } catch (e) {
        console.error('[sessionUi] session.selected: meta/usage fetch error:', e)
      } finally {
        console.log('[sessionUi] session.selected: clearing hydration flags')
        useSessionUi.setState({ isHydratingMeta: false, isHydratingUsage: false })
      }
    }, 0)
  })

  // Initial hydration and re-hydration helper (hoisted above runOnce to avoid race)
  // This now focuses only on session-scoped meta and usage. Provider/model settings
  // and flow templates are hydrated via hydrateSessionUiSettingsAndFlows() so they
  // are not coupled to session list/timeline hydration.
  const hydrateAll = async () => {
    ;(async () => {
      try {
        const settled = await Promise.allSettled([
          client.rpc('session.getCurrentMeta', {}),
          client.rpc('session.getUsageStrict', {}),
        ])

        const getVal = (idx: number) => (settled[idx] && (settled[idx] as PromiseSettledResult<any>).status === 'fulfilled')
          ? (settled[idx] as PromiseFulfilledResult<any>).value
          : null

        const metaRes = getVal(0)
        const usageRes = getVal(1)

        if (metaRes?.ok) {
          useSessionUi.getState().__setMeta({
            executedFlowId: metaRes.lastUsedFlow || '',
            providerId: metaRes.providerId || '',
            modelId: metaRes.modelId || '',
          })
        } else {
          useSessionUi.getState().__setMeta({ executedFlowId: '', providerId: '', modelId: '' })
        }

        if (usageRes?.ok) {
          useSessionUi.getState().__setUsage(usageRes.tokenUsage, usageRes.costs, Array.isArray(usageRes.requestsLog) ? usageRes.requestsLog : [])
        } else {
          useSessionUi.getState().__setUsage(undefined, undefined, [])
        }
      } catch {}
    })()
  }

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

  // Hydrate exactly once per window when the backend declares the workspace ready.
  // Even if the sessions list was already hydrated via push events, we still
  // need to fetch meta/settings/usage/templates here, so do not short-circuit
  // on hasHydratedList.
  let hydratedOnce = false
  const runOnce = async (source: string) => {
    if (hydratedOnce) {
      console.log('[sessionUi] runOnce: already ran, source=', source)
      return
    }
    hydratedOnce = true
    console.log('[sessionUi] runOnce: starting hydration, source=', source)
    try { await hydrateAll() } catch (e) {
      console.error('[sessionUi] runOnce: hydrateAll error', e)
    }
    try {
      console.log('[sessionUi] runOnce: calling hydrateSessionUiSettingsAndFlows')
      await hydrateSessionUiSettingsAndFlows()
    } catch (e) {
      console.error('[sessionUi] runOnce: hydrateSessionUiSettingsAndFlows error', e)
    }
    try { await ensureSelectionIfNone() } catch (e) {
      console.error('[sessionUi] runOnce: ensureSelectionIfNone error', e)
    }
    console.log('[sessionUi] runOnce: finished hydration')

    // Signal to the hydration state machine that we're ready
    try {
      const { markHydrationReady } = await import('./hydration')
      markHydrationReady()
    } catch (e) {
      console.warn('[sessionUi] Failed to mark hydration ready:', e)
    }
  }

  // Primary trigger: workspace.ready from backend
  console.log('[sessionUi] Registering workspace.ready subscription')
  client.subscribe('workspace.ready', async (_p: any) => {
    console.log('[sessionUi] workspace.ready received, triggering runOnce')
    await runOnce('workspace.ready')
  })
  console.log('[sessionUi] workspace.ready subscription registered')

  // Fallback: if we are already attached and never see workspace.ready (e.g. auto-bound first window)
  const b = useBackendBinding.getState()
  if (b.attached) {
    console.log('[sessionUi] backend already attached, triggering runOnce fallback')
    void runOnce('backend.attached.initial')
  } else {
    console.log('[sessionUi] backend not yet attached at init, waiting on workspace.attached to hydrate')
  }

  // Subscribe to workspace.attached so we can hydrate when this window binds
  console.log('[sessionUi] Registering workspace.attached subscription')
  client.subscribe('workspace.attached', async (p: any) => {
    console.log('[sessionUi] workspace.attached received, triggering runOnce', p)
    await runOnce('workspace.attached')
  })
  console.log('[sessionUi] workspace.attached subscription registered')

  // Keep flows/models selectors fresh when Flow Editor or settings change
  client.subscribe('flowEditor.graph.changed', async (_p: any) => {
    console.log('[sessionUi] flowEditor.graph.changed received, refreshing templates snapshot')
    try {
      await hydrateSessionUiSettingsAndFlows()
    } catch (e) {
      console.error('[sessionUi] flowEditor.graph.changed: hydrateSessionUiSettingsAndFlows error', e)
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
    try { useSessionUi.getState().__setUsage(p?.tokenUsage, p?.costs, Array.isArray(p?.requestsLog) ? p.requestsLog : []) } catch {}
  })







  // Safety fallback: if attach happens but primary hydrate path was skipped due to early exception,
  // run a minimal hydration after a short delay. This lives outside the main try/catch so it always runs.
  try {
    let fallbackRan = false
    const RPC_TIMEOUT = 5000
    const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> => {
      return Promise.race([
        promise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
      ])
    }

    const fallbackHydrate = async () => {
      if (fallbackRan || useSessionUi.getState().hasHydratedList) return
      fallbackRan = true
      const c = getBackendClient()
      if (!c) return
      try {
        const res = await withTimeout(c.rpc('session.list', {}), RPC_TIMEOUT)
        const sessions: Array<{ id: string; title: string }> = Array.isArray(res?.sessions) ? res.sessions : []
        const currentId: string | null = (res?.currentId ?? null) as any
        try { useSessionUi.getState().__setSessions(sessions, currentId) } catch {}
        if (currentId) {
          try { useChatTimeline.setState({ isHydrating: true }) } catch {}
          try {
            const snap = await withTimeout(c.rpc('session.getCurrentStrict', {}), RPC_TIMEOUT)
            if (snap && snap.id === currentId) {
              const items = Array.isArray(snap.items) ? snap.items : []
              try { useChatTimeline.getState().hydrateFromSession(items) } catch {}
            } else {
              // If no snapshot, ensure isHydrating is cleared
              try { useChatTimeline.setState({ isHydrating: false }) } catch {}
            }
          } catch {
            // Ensure isHydrating is cleared on error
            try { useChatTimeline.setState({ isHydrating: false }) } catch {}
          }
        } else if (sessions.length > 0) {
          // Ensure there is a selected session so timeline/meta can proceed
          try { await withTimeout(c.rpc('session.select', { id: sessions[0].id }), RPC_TIMEOUT) } catch {}
        }
      } catch (e) {
        console.warn('[sessionUi] fallbackHydrate failed:', e)
        // Ensure all hydration flags are cleared on failure
        try { useChatTimeline.setState({ isHydrating: false }) } catch {}
      }
    }

    // If already attached when this file loads, schedule fallback soon
    try {
      const b = useBackendBinding.getState()
      if (b.attached) {
        setTimeout(() => { void fallbackHydrate() }, 350)
      }
    } catch {}

    // Also subscribe to future attachments
    useBackendBinding.subscribe((s: { attached: boolean }) => s.attached, (attached: boolean) => {
      if (!attached) return
      setTimeout(() => {
        void fallbackHydrate()
      }, 350)
    })
  } catch {}

}

// Explicit helper to hydrate provider/model settings and available flows without
// coupling to session list hydration. Safe to call from renderer components like
// SessionControlsBar; it uses the same backend RPCs as SettingsPane and FlowCanvasPanel.
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


