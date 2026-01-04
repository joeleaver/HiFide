import { create } from 'zustand'
import { getBackendClient } from '../lib/backend/bootstrap'
import { useFlowEditorLocal } from './flowEditorLocal'


export type TimelineMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string; mimeType: string }

export type TimelineItem =
  | { type: 'message'; id: string; role: 'user' | 'assistant'; content: string | TimelineMessagePart[] }
  | { type: 'node-execution'; id: string; nodeId: string; executionId?: string; nodeLabel?: string; nodeKind?: string; provider?: string; model?: string; cost?: any; content: Array<{ type: 'text'; text: string } | { type: 'reasoning'; text: string } | { type: 'badge'; badge: any } | { type: 'error'; text: string }>; badges?: any[] }

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
  addUserMessage: (content: string | TimelineMessagePart[]) => void
  openNodeExecution: (nodeId: string, nodeLabel?: string, nodeKind?: string, executionId?: string) => string /* boxId */
  appendText: (nodeId: string, text: string, executionId?: string) => void
  appendReasoning: (nodeId: string, text: string, executionId?: string) => void

  addToolBadge: (nodeId: string, badge: any, executionId?: string) => void
  appendError: (nodeId: string, error: string, executionId?: string) => void
  updateBadge: (nodeId: string, badgeId: string, updates: any, executionId?: string) => void
  updateBoxMeta: (nodeId: string, meta: Partial<{ provider: string; model: string; cost: any }>, executionId?: string) => void
}

function computeSig(items: TimelineItem[]): string {
  if (!items.length) return '0'
  const last = items[items.length - 1]
  if (last.type === 'message') {
    const contentLen = typeof last.content === 'string' ? last.content.length : last.content.length
    return `${items.length}:${last.type}:${last.role}:${contentLen}`
  }
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

    clear: () => {
      // console.log('[chatTimeline] clear() called')
      set({ items: [], sig: '0', hasRenderedOnce: false })
    },

    hydrateFromSession: (items) => {
      const arr = Array.isArray(items) ? items.slice() as TimelineItem[] : []

      // Deduplicate by ID (keep first occurrence)
      const seen = new Set<string>()
      const deduped = arr.filter(item => {
        if (seen.has(item.id)) {
          // console.warn('[chatTimeline] Duplicate item ID detected, skipping:', item.id)
          return false
        }
        seen.add(item.id)
        return true
      })

      // Also deduplicate badges within each node-execution item
      const cleaned = deduped.map(item => {
        if (item.type === 'node-execution') {
          // Deduplicate content items (which contain badges)
          const contentSeen = new Set<string>()
          const uniqueContent = (item.content || []).filter((c: any) => {
            if (c.type === 'badge' && c.badge?.id) {
              if (contentSeen.has(c.badge.id)) {
                // console.warn('[chatTimeline] Duplicate badge in content, skipping:', c.badge.id)
                return false
              }
              contentSeen.add(c.badge.id)
            }
            return true
          })

          // Also check the badges array if it exists
          let uniqueBadges = item.badges
          if (Array.isArray(item.badges)) {
            const badgeSeen = new Set<string>()
            uniqueBadges = item.badges.filter((badge: any) => {
              if (badgeSeen.has(badge.id)) {
                // console.warn('[chatTimeline] Duplicate badge in badges array, skipping:', badge.id)
                return false
              }
              badgeSeen.add(badge.id)
              return true
            })
          }

          return { ...item, content: uniqueContent, badges: uniqueBadges }
        }
        return item
      })

      set((prev: ChatTimelineState) => {
        const newState = {
          ...prev,
          items: cleaned,
          sig: computeSig(cleaned),
          isHydrating: false,
          hasRenderedOnce: false,
          hydrationVersion: (prev?.hydrationVersion || 0) + 1,
        }
        console.log('[chatTimeline] hydrateFromSession complete:', { itemCount: cleaned.length, hydrationVersion: newState.hydrationVersion, isHydrating: newState.isHydrating })
        return newState
      })

      // Verify the state was actually updated
      const afterState = get()
      console.log('[chatTimeline] State after set():', { isHydrating: afterState.isHydrating, hydrationVersion: afterState.hydrationVersion })
    },

    appendRawItem: (item) => {
      // Deduplicate: skip if item with same ID already exists
      const existing = get().items
      if (existing.some(i => i.id === item.id)) {
        console.warn('[chatTimeline] appendRawItem: duplicate ID, skipping:', item.id)
        return
      }
      const items = [...existing, item] as TimelineItem[]
      set({ items, sig: computeSig(items) })
    },

    addUserMessage: (content) => {
      const id = `msg-${Date.now()}`
      const items = [
        ...get().items,
        { type: 'message' as const, id, role: 'user' as const, content },
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
          ; (get() as any).openNodeExecution(nodeId, label, kind, executionId)
        items = [...get().items] as TimelineItem[]
        box = items.slice().reverse().find((it) => it.type === 'node-execution' && it.nodeId === nodeId && (!executionId || (it as any).executionId === executionId)) as any
        if (!box) return
      }
      // Deduplicate: check if the last content item is the same text
      const lastContent = box.content[box.content.length - 1]
      if (lastContent?.type === 'text' && lastContent.text === txt) {
        console.warn('[chatTimeline] appendText: duplicate text, skipping:', txt.slice(0, 50))
        return
      }
      box.content.push({ type: 'text', text: txt } as any)
      set({ items, sig: computeSig(items) })
    },


    appendReasoning: (nodeId, text, executionId) => {
      let txt = (text ?? '').toString()
      if (typeof text === 'object' && text !== null) {
        try {
          txt = (text as any).text || (text as any).content || JSON.stringify(text)
        } catch {
          txt = String(text)
        }
      }

      // Do not render a 'thinking' block for blank/whitespace-only content
      if (txt.trim().length === 0) return
      let items = [...get().items] as TimelineItem[]
      let box = items.slice().reverse().find((it) => it.type === 'node-execution' && it.nodeId === nodeId && (!executionId || (it as any).executionId === executionId)) as any
      if (!box) {
        const node = useFlowEditorLocal.getState().nodes.find((n: any) => n.id === nodeId)
        const label = node?.data?.label || node?.data?.labelBase || 'Node'
        const kind = node?.data?.nodeType || 'unknown'
          ; (get() as any).openNodeExecution(nodeId, label, kind, executionId)
        items = [...get().items] as TimelineItem[]
        box = items.slice().reverse().find((it) => it.type === 'node-execution' && it.nodeId === nodeId && (!executionId || (it as any).executionId === executionId)) as any
        if (!box) return
      }
      // Deduplicate: check if the last content item is the same reasoning
      const lastContent = box.content[box.content.length - 1]
      if (lastContent?.type === 'reasoning' && lastContent.text === txt) {
        console.warn('[chatTimeline] appendReasoning: duplicate reasoning, skipping:', txt.slice(0, 50))
        return
      }
      box.content.push({ type: 'reasoning', text: txt } as any)
      set({ items, sig: computeSig(items) })
    },

    appendError: (nodeId, error, executionId) => {
      const err = (error ?? '').toString()
      if (err.length === 0) return
      let items = [...get().items] as TimelineItem[]
      let box = items.slice().reverse().find((it) => it.type === 'node-execution' && it.nodeId === nodeId && (!executionId || (it as any).executionId === executionId)) as any
      if (!box) {
        const node = useFlowEditorLocal.getState().nodes.find((n: any) => n.id === nodeId)
        const label = node?.data?.label || node?.data?.labelBase || 'Node'
        const kind = node?.data?.nodeType || 'unknown'
          ; (get() as any).openNodeExecution(nodeId, label, kind, executionId)
        items = [...get().items] as TimelineItem[]
        box = items.slice().reverse().find((it) => it.type === 'node-execution' && it.nodeId === nodeId && (!executionId || (it as any).executionId === executionId)) as any
        if (!box) return
      }
      box.content.push({ type: 'error', text: err } as any)
      set({ items, sig: computeSig(items) })
    },

    addToolBadge: (nodeId, badge, executionId) => {
      let items = [...get().items] as TimelineItem[]
      let box = items.slice().reverse().find((it) => it.type === 'node-execution' && it.nodeId === nodeId && (!executionId || (it as any).executionId === executionId)) as any
      if (!box) {
        const node = useFlowEditorLocal.getState().nodes.find((n: any) => n.id === nodeId)
        const label = node?.data?.label || node?.data?.labelBase || 'Node'
        const kind = node?.data?.nodeType || 'unknown'
          ; (get() as any).openNodeExecution(nodeId, label, kind, executionId)
        items = [...get().items] as TimelineItem[]
        box = items.slice().reverse().find((it) => it.type === 'node-execution' && it.nodeId === nodeId && (!executionId || (it as any).executionId === executionId)) as any
        if (!box) return
      }

      // Check if badge with this ID already exists
      const badgeId = badge?.id
      if (badgeId) {
        const exists = box.content.some((c: any) => c.type === 'badge' && c.badge?.id === badgeId)
        if (exists) {
          console.warn('[chatTimeline] Badge already exists, skipping:', badgeId)
          return
        }
      }

      box.content.push({ type: 'badge', badge } as any)
      set({ items, sig: computeSig(items) })
    },

    updateBadge: (nodeId, badgeId, updates, executionId) => {
      const items = [...get().items]
      const box = items.slice().reverse().find((it) => it.type === 'node-execution' && it.nodeId === nodeId && (!executionId || (it as any).executionId === executionId)) as any
      if (!box) {
        console.warn('[chatTimeline] updateBadge: box not found', { nodeId, executionId })
        return
      }
      // Search by callId (which is passed as badgeId parameter)
      const idx = box.content.slice().reverse().findIndex((c: any) => c.type === 'badge' && c.badge?.callId === badgeId)
      if (idx >= 0) {
        const revIdx = box.content.length - 1 - idx
        const oldBadge = (box.content[revIdx] as any).badge
        const updatedBadge = { ...oldBadge, ...updates }
        console.log('[chatTimeline] updateBadge: updating badge', {
          callId: badgeId,
          oldLabel: oldBadge?.label,
          newLabel: updates.label,
          oldStatus: oldBadge?.status,
          newStatus: updates.status,
          oldInteractive: oldBadge?.interactive,
          newInteractive: updates.interactive,
          finalInteractive: updatedBadge.interactive,
          allUpdates: updates
        })
        box.content[revIdx] = { type: 'badge', badge: updatedBadge }
        set({ items, sig: computeSig(items) })
      } else {
        console.warn('[chatTimeline] updateBadge: badge not found', { callId: badgeId, boxContentCount: box.content.length })
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
import { type StoreApi, type UseBoundStore } from 'zustand'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const __chatTimelineStore = (hotData.chatTimelineStore || createChatTimelineStore()) as UseBoundStore<StoreApi<ChatTimelineState>>

export const useChatTimeline = __chatTimelineStore

if ((import.meta as any).hot) {
  (import.meta as any).hot.dispose((data: any) => {
    data.chatTimelineStore = __chatTimelineStore
  })
}

let _chatTimelineEventsInitialized = false

export function initChatTimelineEvents(): void {
  if (_chatTimelineEventsInitialized) {
    console.log('[chatTimeline] Events already initialized, skipping')
    return
  }
  _chatTimelineEventsInitialized = true
  console.log('[chatTimeline] Initializing events')

  const client = getBackendClient()
  if (!client) return

  const processDelta = (msg: any) => {
    const op = msg?.op
    //console.log('[chatTimeline] processDelta received:', { op, hasItem: !!msg?.item, item: msg?.item })
    if (op === 'message' && msg.item) {
      // console.log('[chatTimeline] Adding message to timeline:', msg.item)
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
      } catch { }

      const append = msg.append || {}
      if (append.reasoning) useChatTimeline.getState().appendReasoning(msg.nodeId, append.reasoning, msg.executionId)
      if (append.text) useChatTimeline.getState().appendText(msg.nodeId, append.text, msg.executionId)
      if (append.error) useChatTimeline.getState().appendError(msg.nodeId, append.error, msg.executionId)
      if (Array.isArray(append.badges)) {
        for (const b of append.badges) useChatTimeline.getState().addToolBadge(msg.nodeId, b, msg.executionId)
      }
      return
    }

    if (op === 'updateBadge' && msg.nodeId && msg.callId) {
      console.log('[chatTimeline] Delta handler received updateBadge:', {
        callId: msg.callId,
        hasUpdates: !!msg.updates,
        updatesInteractive: msg.updates?.interactive,
        updatesInteractiveJSON: JSON.stringify(msg.updates?.interactive),
        fullUpdatesJSON: JSON.stringify(msg.updates),
        fullMsg: msg
      })
      useChatTimeline.getState().updateBadge(msg.nodeId, msg.callId, msg.updates || {}, msg.executionId)
      return
    }

    if (op === 'updateBoxMeta' && msg.nodeId && msg.meta) {
      useChatTimeline.getState().updateBoxMeta(msg.nodeId, msg.meta, msg.executionId)
      return
    }
  }

  // Timeline deltas
  client.subscribe('session.timeline.delta', processDelta)

  // Timeline snapshots (full hydration)
  client.subscribe('session.timeline.snapshot', (msg: any) => {
    console.log('[chatTimeline] session.timeline.snapshot received:', { msg, isArray: Array.isArray(msg?.items), itemCount: msg?.items?.length })
    const items = Array.isArray(msg?.items) ? msg.items as TimelineItem[] : []
    useChatTimeline.getState().hydrateFromSession(items)
  })

  // Session selection changes - clear and wait for snapshot
  client.subscribe('session.selected', () => {
    console.log('[chatTimeline] session.selected received, clearing timeline')
    useChatTimeline.setState({ isHydrating: true })
    useChatTimeline.getState().clear()
  })

  // Workspace changes - clear and wait for snapshot
  client.subscribe('workspace.attached', () => {
    console.log('[chatTimeline] workspace.attached received, clearing timeline')
    useChatTimeline.setState({ isHydrating: true })
    useChatTimeline.getState().clear()
  })

}



export async function switchTimelineToCurrentSession(): Promise<void> {
  const client: any = getBackendClient()
  if (!client) return
  try { await (client as any).whenReady?.(5000) } catch { }
  try {
    const snap = await client.rpc('session.getCurrentStrict', {})
    if (snap && Array.isArray(snap.items)) {
      useChatTimeline.getState().hydrateFromSession(snap.items)
    } else {
      useChatTimeline.getState().hydrateFromSession([])
    }
  } catch { }
}
