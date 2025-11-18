import { create } from 'zustand'
import { getBackendClient } from '../lib/backend/bootstrap'
import { setCurrentTimelineSessionId, useChatTimeline } from './chatTimeline'
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

interface SessionUiState extends SessionUsageState, SessionMetaState {
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
      try { setCurrentTimelineSessionId(id) } catch {}
      try {
        set({ isHydratingMeta: true, isHydratingUsage: true })
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
        if (snap && snap.id === id) {
          const items = Array.isArray(snap.items) ? snap.items : []
          try { useChatTimeline.getState().hydrateFromSession(items) } catch {}
        }
      } catch {} finally {
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
            try { setCurrentTimelineSessionId(curId) } catch {}
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
    __setSettings: (providerValid, modelsByProvider) => set({ providerValid, modelsByProvider }),
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

let inited = false
export function initSessionUiEvents(): void {
  if (inited) {
    console.log('[sessionUi] initSessionUiEvents: already inited, skipping')
    return
  }

  const client = getBackendClient()
  if (!client) {
    console.log('[sessionUi] initSessionUiEvents: no backend client')
    return // Do not mark inited until a live client exists; bootstrap will call again on open
  }
  inited = true
  console.log('[sessionUi] initSessionUiEvents: starting with backend client')


  // Mark that event subscription init ran with a live client (debug)
  try { useSessionUi.setState({ eventsInited: true }) } catch {}

  // Subscribe to backend SoT events
  try {

    client.subscribe('session.selected', (p: any) => {
      const id = p?.id || null
      try { useSessionUi.getState().__setSelected(id) } catch {}
      try { setCurrentTimelineSessionId(id) } catch {}
      // Reset flow runtime immediately to follow the newly selected session
      try { useFlowRuntime.getState().reset() } catch {}
      // Ensure runtime scoping follows backend-selected session
      try { useFlowRuntime.getState().setSessionScope(id) } catch {}
      // Seed status with retry to show Waiting/Running promptly
      try { void refreshFlowRuntimeStatusWithRetry([150, 300, 600]) } catch {}

      // Only fetch meta/usage here; timeline snapshot will arrive via 'session.timeline.snapshot'
      setTimeout(async () => {
        try {
          useSessionUi.setState({ isHydratingMeta: true, isHydratingUsage: true })
          const [meta, usage] = await Promise.all([
            client.rpc('session.getCurrentMeta', {}),
            client.rpc('session.getUsageStrict', {}),
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
        } catch {} finally {
          useSessionUi.setState({ isHydratingMeta: false, isHydratingUsage: false })
        }
      }, 0)
    })
  } catch {}

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

      await client.rpc('session.select', { id: state.sessions[0].id })
    } catch {}

  }

  // Hydrate exactly once per window when the backend declares the workspace ready.
  // Even if the sessions list was already hydrated via push events, we still
  // need to fetch meta/settings/usage/templates here, so do not short-circuit
  // on hasHydratedList.
  try {
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
    }

    // Primary trigger: workspace.ready from backend
    try {
      client.subscribe('workspace.ready', async (_p: any) => {
        console.log('[sessionUi] workspace.ready received, triggering runOnce')
        await runOnce('workspace.ready')
      })
    } catch (e) {
      console.error('[sessionUi] subscribe workspace.ready failed', e)
    }

    // Fallback: if we are already attached and never see workspace.ready (e.g. auto-bound first window)
    try {
      const b = useBackendBinding.getState()
      if (b.attached) {
        console.log('[sessionUi] backend already attached, triggering runOnce fallback')
        void runOnce('backend.attached.initial')
      } else {
        console.log('[sessionUi] backend not yet attached at init, waiting on workspace.attached to hydrate')
      }
    } catch (e) {
      console.error('[sessionUi] fallback attached check failed', e)
    }

    // Subscribe to workspace.attached so we can hydrate when this window binds
    try {
      client.subscribe('workspace.attached', async (p: any) => {
        console.log('[sessionUi] workspace.attached received, triggering runOnce', p)
        await runOnce('workspace.attached')
      })
    } catch (e) {
      console.error('[sessionUi] subscribe workspace.attached failed', e)
    }
  } catch (e) {
    console.error('[sessionUi] initSessionUiEvents: hydrateOnce block failed', e)
  }

  // Keep flows/models selectors fresh when Flow Editor or settings change
  try {
    client.subscribe('flowEditor.graph.changed', async (_p: any) => {
      console.log('[sessionUi] flowEditor.graph.changed received, refreshing templates snapshot')
      try {
        await hydrateSessionUiSettingsAndFlows()
      } catch (e) {
        console.error('[sessionUi] flowEditor.graph.changed: hydrateSessionUiSettingsAndFlows error', e)
      }
    })
  } catch (e) {
    console.error('[sessionUi] subscribe flowEditor.graph.changed failed', e)
  }

  try {
    client.subscribe('settings.models.changed', (p: any) => {
      console.log('[sessionUi] settings.models.changed received, updating provider/models snapshot')
      try {
        useSessionUi.getState().__setSettings(p?.providerValid || {}, p?.modelsByProvider || {})
      } catch (e) {
        console.warn('[sessionUi] settings.models.changed: __setSettings failed', e)
      }
    })
  } catch (e) {
    console.error('[sessionUi] subscribe settings.models.changed failed', e)
  }

  try {
    client.subscribe('session.list.changed', (p: any) => {
      const list = Array.isArray(p?.sessions) ? p.sessions as SessionSummary[] : []
      const currentId = (p?.currentId ?? null) as string | null
      try { useSessionUi.getState().__setSessions(list, currentId) } catch {}
    })
  } catch {}

  try {
    client.subscribe('session.usage.changed', (p: any) => {
      try { useSessionUi.getState().__setUsage(p?.tokenUsage, p?.costs, Array.isArray(p?.requestsLog) ? p.requestsLog : []) } catch {}
    })
  } catch {}







  // Safety fallback: if attach happens but primary hydrate path was skipped due to early exception,
  // run a minimal hydration after a short delay. This lives outside the main try/catch so it always runs.
  try {
    let fallbackRan = false
    const fallbackHydrate = async () => {
      if (fallbackRan || useSessionUi.getState().hasHydratedList) return
      fallbackRan = true
      const c = getBackendClient()
      if (!c) return
      try {
        const res = await c.rpc('session.list', {})
        const sessions: Array<{ id: string; title: string }> = Array.isArray(res?.sessions) ? res.sessions : []
        const currentId: string | null = (res?.currentId ?? null) as any
        try { useSessionUi.getState().__setSessions(sessions, currentId) } catch {}
        if (currentId) {
          try { setCurrentTimelineSessionId(currentId) } catch {}
          try { useChatTimeline.setState({ isHydrating: true }) } catch {}
          try {
            const snap = await c.rpc('session.getCurrentStrict', {})
            if (snap && snap.id === currentId) {
              const items = Array.isArray(snap.items) ? snap.items : []
              try { useChatTimeline.getState().hydrateFromSession(items) } catch {}
            }
          } catch {}
        } else if (sessions.length > 0) {
          // Ensure there is a selected session so timeline/meta can proceed
          try { await c.rpc('session.select', { id: sessions[0].id }) } catch {}
        }
      } catch {}
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
    console.log('[sessionUi] hydrateSessionUiSettingsAndFlows: requesting settings.get + flowEditor.getTemplates')
    const settled = await Promise.allSettled([
      client.rpc('settings.get', {}),
      client.rpc('flowEditor.getTemplates', {}),
    ])

    const getVal = (idx: number) => (settled[idx] && (settled[idx] as PromiseSettledResult<any>).status === 'fulfilled')
      ? (settled[idx] as PromiseFulfilledResult<any>).value
      : null

    const settingsRes = getVal(0)
    const templates = getVal(1)

    console.log('[sessionUi] hydrateSessionUiSettingsAndFlows: settings.get ->', {
      ok: settingsRes?.ok,
      providerKeys: settingsRes?.providerValid ? Object.keys(settingsRes.providerValid) : [],
      modelProviderKeys: settingsRes?.modelsByProvider ? Object.keys(settingsRes.modelsByProvider) : [],
    })
    console.log('[sessionUi] hydrateSessionUiSettingsAndFlows: flowEditor.getTemplates ->', {
      ok: templates?.ok,
      templateCount: Array.isArray(templates?.templates) ? templates.templates.length : null,
    })

    if (settingsRes?.ok) {
      try {
        useSessionUi.getState().__setSettings(settingsRes.providerValid || {}, settingsRes.modelsByProvider || {})
      } catch (e) {
        console.warn('[sessionUi] hydrateSessionUiSettingsAndFlows: __setSettings failed', e)
      }
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


