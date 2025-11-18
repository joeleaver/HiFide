import { create } from 'zustand'
import { getBackendClient } from '../lib/backend/bootstrap'
import { useFlowEditorLocal } from './flowEditorLocal'

// Track current session to ignore deltas from other sessions (multiple windows may have different sessions)
let currentSessionId: string | null = null
export function setCurrentTimelineSessionId(id: string | null) {
  currentSessionId = id
}


export type TimelineItem =
  | { type: 'message'; id: string; role: 'user' | 'assistant'; content: string }
  | { type: 'node-execution'; id: string; nodeId: string; executionId?: string; nodeLabel?: string; nodeKind?: string; provider?: string; model?: string; cost?: any; content: Array<{ type: 'text'; text: string } | { type: 'reasoning'; text: string } | { type: 'badge'; badge: any }> }

interface ChatTimelineState {
  items: TimelineItem[]
  // Derived minimal signature for render optimization in SessionPane
  sig: string
  // Hydration flag for UI feedback
  isHydrating: boolean
  // True once the timeline has completed its first render for the current session
  hasRenderedOnce: boolean
  // Monotonic counter that increments on each full snapshot hydrate
  hydrationVersion: number

  // Mutators (renderer-only)
  clear: () => void
  hydrateFromSession: (items: TimelineItem[]) => void
  appendRawItem: (item: TimelineItem) => void
  addUserMessage: (text: string) => void
  openNodeExecution: (nodeId: string, nodeLabel?: string, nodeKind?: string, executionId?: string) => string /* boxId */
  appendText: (nodeId: string, text: string, executionId?: string) => void
  appendReasoning: (nodeId: string, text: string, executionId?: string) => void

  addToolBadge: (nodeId: string, badge: any, executionId?: string) => void
  updateBadge: (nodeId: string, badgeId: string, updates: any, executionId?: string) => void
  updateBoxMeta: (nodeId: string, meta: Partial<{ provider: string; model: string; cost: any }>, executionId?: string) => void
}

function computeSig(items: TimelineItem[]): string {
  if (!items.length) return '0'
  const last = items[items.length - 1]
  if (last.type === 'message') return `${items.length}:${last.type}:${last.role}:${last.content.length}`
  const len = last.content?.length || 0
  const lc = len ? last.content[len - 1] : undefined
  if (!lc) return `${items.length}:${last.type}:none`
  if (lc.type === 'text') return `${items.length}:${last.type}:text:${lc.text.length}`
  if (lc.type === 'reasoning') return `${items.length}:${last.type}:reasoning:${lc.text.length}`
  const b = (lc as any).badge || {}
  return `${items.length}:${last.type}:badge:${b.status || ''}:${b.addedLines ?? ''}:${b.removedLines ?? ''}:${b.label || ''}`
}

function createChatTimelineStore() {
  return create<ChatTimelineState>((set, get) => ({
    items: [],
    sig: '0',
    isHydrating: false,
    hasRenderedOnce: false,
    hydrationVersion: 0,

    clear: () => set({ items: [], sig: '0', hasRenderedOnce: false }),

    hydrateFromSession: (items) => {
      const arr = Array.isArray(items) ? items.slice() as TimelineItem[] : []
      set((prev: ChatTimelineState) => ({
        items: arr,
        sig: computeSig(arr),
        isHydrating: false,
        hasRenderedOnce: false,
        hydrationVersion: (prev?.hydrationVersion || 0) + 1,
      }))
    },

    appendRawItem: (item) => {
      const items = [...get().items, item] as TimelineItem[]
      set({ items, sig: computeSig(items) })
    },

    addUserMessage: (text) => {
      const id = `msg-${Date.now()}`
      const items = [
        ...get().items,
        { type: 'message' as const, id, role: 'user' as const, content: text },
      ] as TimelineItem[]
      set({ items, sig: computeSig(items) })
    },

    openNodeExecution: (nodeId, nodeLabel, nodeKind, executionId) => {
      const id = `box-${nodeId}-${executionId || Date.now()}`
      const box: TimelineItem = { type: 'node-execution', id, nodeId, executionId, nodeLabel, nodeKind, content: [] as any }
      const items = [...get().items, box] as TimelineItem[]
      set({ items, sig: computeSig(items) })
      return id
    },

    appendText: (nodeId, text, executionId) => {
      const txt = (text ?? '').toString()
      // Preserve whitespace-only deltas (some providers stream spaces/newlines early)
      if (txt.length === 0) return
      let items = [...get().items] as TimelineItem[]
      // Find last box for nodeId (+executionId when provided), otherwise open
      let box = items.slice().reverse().find((it) => it.type === 'node-execution' && it.nodeId === nodeId && (!executionId || (it as any).executionId === executionId)) as any
      if (!box) {
        const node = useFlowEditorLocal.getState().nodes.find((n: any) => n.id === nodeId)
        const label = node?.data?.label || node?.data?.labelBase || 'Node'
        const kind = node?.data?.nodeType || 'unknown'
        ;(get() as any).openNodeExecution(nodeId, label, kind, executionId)
        items = [...get().items] as TimelineItem[]
        box = items.slice().reverse().find((it) => it.type === 'node-execution' && it.nodeId === nodeId && (!executionId || (it as any).executionId === executionId)) as any
        if (!box) return
      }
      box.content.push({ type: 'text', text: txt } as any)
      set({ items, sig: computeSig(items) })
    },


    appendReasoning: (nodeId, text, executionId) => {
      const txt = (text ?? '').toString()
      // Do not render a 'thinking' block for blank/whitespace-only content
      if (txt.trim().length === 0) return
      let items = [...get().items] as TimelineItem[]
      let box = items.slice().reverse().find((it) => it.type === 'node-execution' && it.nodeId === nodeId && (!executionId || (it as any).executionId === executionId)) as any
      if (!box) {
        const node = useFlowEditorLocal.getState().nodes.find((n: any) => n.id === nodeId)
        const label = node?.data?.label || node?.data?.labelBase || 'Node'
        const kind = node?.data?.nodeType || 'unknown'
        ;(get() as any).openNodeExecution(nodeId, label, kind, executionId)
        items = [...get().items] as TimelineItem[]
        box = items.slice().reverse().find((it) => it.type === 'node-execution' && it.nodeId === nodeId && (!executionId || (it as any).executionId === executionId)) as any
        if (!box) return
      }
      box.content.push({ type: 'reasoning', text: txt } as any)
      set({ items, sig: computeSig(items) })
    },

    addToolBadge: (nodeId, badge, executionId) => {
      let items = [...get().items] as TimelineItem[]
      let box = items.slice().reverse().find((it) => it.type === 'node-execution' && it.nodeId === nodeId && (!executionId || (it as any).executionId === executionId)) as any
      if (!box) {
        const node = useFlowEditorLocal.getState().nodes.find((n: any) => n.id === nodeId)
        const label = node?.data?.label || node?.data?.labelBase || 'Node'
        const kind = node?.data?.nodeType || 'unknown'
        ;(get() as any).openNodeExecution(nodeId, label, kind, executionId)
        items = [...get().items] as TimelineItem[]
        box = items.slice().reverse().find((it) => it.type === 'node-execution' && it.nodeId === nodeId && (!executionId || (it as any).executionId === executionId)) as any
        if (!box) return
      }
      box.content.push({ type: 'badge', badge } as any)
      set({ items, sig: computeSig(items) })
    },

    updateBadge: (nodeId, badgeId, updates, executionId) => {
      const items = [...get().items]
      const box = items.slice().reverse().find((it) => it.type === 'node-execution' && it.nodeId === nodeId && (!executionId || (it as any).executionId === executionId)) as any
      if (!box) return
      const idx = box.content.slice().reverse().findIndex((c: any) => c.type === 'badge' && c.badge?.id === badgeId)
      if (idx >= 0) {
        const revIdx = box.content.length - 1 - idx
        box.content[revIdx] = { type: 'badge', badge: { ...(box.content[revIdx] as any).badge, ...updates } }
        set({ items, sig: computeSig(items) })
      }
    },

    updateBoxMeta: (nodeId, meta, executionId) => {
      const items = [...get().items]
      let idx = items.slice().reverse().findIndex((it: any) => it.type === 'node-execution' && it.nodeId === nodeId && (!executionId || (it as any).executionId === executionId))
      if (idx === -1) return
      const revIdx = items.length - 1 - idx
      const box: any = { ...items[revIdx], ...meta }
      items[revIdx] = box
      set({ items, sig: computeSig(items) })
    },
  }))
}

// Reuse the same store across HMR reloads to avoid desync between subscriptions and UI
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hotData: any = (import.meta as any).hot?.data || {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const __chatTimelineStore: any = hotData.chatTimelineStore || createChatTimelineStore()

export const useChatTimeline = __chatTimelineStore

if ((import.meta as any).hot) {
  (import.meta as any).hot.dispose((data: any) => {
    data.chatTimelineStore = __chatTimelineStore
  })
}

let unsubscribe: (() => void) | null = null
export function initChatTimelineEvents(): void {
  // Ensure previous subscription is removed (idempotent across reconnects)
  try { unsubscribe?.() } catch {}
  const client = getBackendClient()
  if (!client) return

  // 1) Subscribe to session selection first — backend is the single source of truth

  const processDelta = (msg: any) => {
    try {
      // Detailed debug logging removed to reduce console noise; rely on ws-render recv logs instead
    } catch {}

    const op = msg?.op
    if (op === 'message' && msg.item) {
      useChatTimeline.getState().appendRawItem(msg.item as TimelineItem)
      return
    }

    if ((op === 'upsertBox' || op === 'appendToBox') && msg.nodeId) {
      try {
        const items = useChatTimeline.getState().items
        const hasBox = !!items
          .slice()
          .reverse()
          .find((it: any) => it.type === 'node-execution' && it.nodeId === msg.nodeId && (!msg.executionId || it.executionId === msg.executionId))
        if (!hasBox) {
          const node = useFlowEditorLocal.getState().nodes.find((n: any) => n.id === msg.nodeId)
          const label = node?.data?.label || node?.data?.labelBase || 'Node'
          const kind = node?.data?.nodeType || 'unknown'
          useChatTimeline.getState().openNodeExecution(msg.nodeId, label, kind, msg.executionId)
        }
      } catch {}

      const append = msg.append || {}
      if (append.reasoning) useChatTimeline.getState().appendReasoning(msg.nodeId, append.reasoning, msg.executionId)
      if (append.text) useChatTimeline.getState().appendText(msg.nodeId, append.text, msg.executionId)
      if (Array.isArray(append.badges)) {
        for (const b of append.badges) useChatTimeline.getState().addToolBadge(msg.nodeId, b, msg.executionId)
      }
      return
    }

    if (op === 'updateBadge' && msg.nodeId && msg.callId) {
      useChatTimeline.getState().updateBadge(msg.nodeId, msg.callId, msg.updates || {}, msg.executionId)
      return
    }

    if (op === 'updateBoxMeta' && msg.nodeId && msg.meta) {
      useChatTimeline.getState().updateBoxMeta(msg.nodeId, msg.meta, msg.executionId)
      return
    }
  }

  unsubscribe = client.subscribe('session.timeline.delta', (msg: any) => {
    const sid = msg?.sessionId as string | undefined

    // If we don't yet know the selected session for this window, adopt the first seen sid.
    if (!currentSessionId && sid) {
      try { setCurrentTimelineSessionId(sid) } catch {}
    }

    if (sid && currentSessionId && sid !== currentSessionId) {
      return
    }

    // If still unknown, ignore (no sid provided)
    if (!currentSessionId) return

    processDelta(msg)
  })

  // Also listen for full timeline snapshots (server broadcasts on items ref changes)
  try {
    client.subscribe('session.timeline.snapshot', (msg: any) => {
      const sid = msg?.sessionId as string | undefined
      const items = Array.isArray(msg?.items) ? (msg.items as TimelineItem[]) : []

      // If we don't yet know our selected session, adopt the snapshot's sessionId
      if (!currentSessionId && sid) {
        try { setCurrentTimelineSessionId(sid) } catch {}
      }
      if (sid && currentSessionId && sid !== currentSessionId) {
        // Adopt server snapshot's sessionId to avoid race with 'session.selected'
        try { setCurrentTimelineSessionId(sid) } catch {}
      }
      if (!currentSessionId && !sid) return

      // Hydrate to reflect canonical store state
      useChatTimeline.getState().hydrateFromSession(items)
    })
  } catch {}


  // 2) Subscribe to selection changes and hydrate from backend SoT
  try {
    client.subscribe('session.selected', (p: any) => {
      const sid = p?.id || null
      try { setCurrentTimelineSessionId(sid) } catch {}
      // Indicate hydration in progress and clear immediately; expect snapshot to arrive from server
      try { useChatTimeline.setState({ isHydrating: true }) } catch {}
      useChatTimeline.getState().clear()
    })
  } catch {}


  // 2b) On workspace change, rehydrate from the new workspace's current session
  try {
    const rehydrateFromWorkspace = async () => {
      try { useChatTimeline.setState({ isHydrating: true }) } catch {}
      try { setCurrentTimelineSessionId(null) } catch {}
      useChatTimeline.getState().clear()
      // No RPC here; server will push session.timeline.snapshot on workspace.ready
    }
    client.subscribe('workspace.bound', rehydrateFromWorkspace)
    client.subscribe('workspace.ready', rehydrateFromWorkspace)
  } catch {}

}



export async function switchTimelineToCurrentSession(): Promise<void> {
  const client: any = getBackendClient()
  if (!client) return
  try { await (client as any).whenReady?.(5000) } catch {}
  try {
    const snap = await client.rpc('session.getCurrentStrict', {})
    if (snap && Array.isArray(snap.items)) {
      try { setCurrentTimelineSessionId(snap.id || null) } catch {}
      useChatTimeline.getState().hydrateFromSession(snap.items)
    } else {
      try { setCurrentTimelineSessionId(null) } catch {}
      useChatTimeline.getState().hydrateFromSession([])
    }
  } catch {}
}
