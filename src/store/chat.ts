import { create } from 'zustand'

export type ChatMessage = { role: 'user' | 'assistant'; content: string }
export type Conversation = {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

function loadConversations(): { conversations: Conversation[]; currentId: string | null } {
  try {
    const raw = localStorage.getItem('hifide:conversations')
    const cur = localStorage.getItem('hifide:conversations:current')
    if (raw) {
      const conversations: Conversation[] = JSON.parse(raw)
      return { conversations, currentId: cur || (conversations[0]?.id ?? null) }
    }
  } catch {}
  const first: Conversation = { id: crypto.randomUUID(), title: 'New Chat', messages: [], createdAt: Date.now(), updatedAt: Date.now() }
  return { conversations: [first], currentId: first.id }
}

function persist(conversations: Conversation[], currentId: string | null) {
  try {
    localStorage.setItem('hifide:conversations', JSON.stringify(conversations))
    if (currentId) localStorage.setItem('hifide:conversations:current', currentId)
  } catch {}
}

export type ChatState = {
  conversations: Conversation[]
  currentId: string | null
  select: (id: string) => void
  newConversation: (title?: string) => string
  rename: (id: string, title: string) => void
  remove: (id: string) => void
  addUserMessage: (content: string) => void
  addAssistantMessage: (content: string) => void
  getCurrentMessages: () => ChatMessage[]
}

const initial = loadConversations()

function deriveTitle(text: string): string {
  const firstLine = text.split('\n')[0].trim()
  if (!firstLine) return 'New Chat'
  return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: initial.conversations,
  currentId: initial.currentId,

  select: (id) => set((s) => {
    persist(s.conversations, id)
    return { currentId: id }
  }),

  newConversation: (title = 'New Chat') => {
    const convo: Conversation = { id: crypto.randomUUID(), title, messages: [], createdAt: Date.now(), updatedAt: Date.now() }
    set((s) => {
      const conversations = [convo, ...s.conversations]
      persist(conversations, convo.id)
      return { conversations, currentId: convo.id }
    })
    return convo.id
  },

  rename: (id, title) => set((s) => {
    const conversations = s.conversations.map((c) => (c.id === id ? { ...c, title, updatedAt: Date.now() } : c))
    persist(conversations, s.currentId)
    return { conversations }
  }),

  remove: (id) => set((s) => {
    const filtered = s.conversations.filter((c) => c.id !== id)
    const currentId = s.currentId === id ? (filtered[0]?.id ?? null) : s.currentId
    persist(filtered, currentId)
    return { conversations: filtered, currentId }
  }),

  addUserMessage: (content) => set((s) => {
    if (!s.currentId) return {}
    const conversations = s.conversations.map((c) => {
      if (c.id !== s.currentId) return c
      const isFirst = c.messages.length === 0
      const newTitle = isFirst && (!c.title || c.title === 'New Chat') ? deriveTitle(content) : c.title
      return {
        ...c,
        title: newTitle,
        messages: [...c.messages, { role: 'user' as const, content }],
        updatedAt: Date.now(),
      }
    })
    persist(conversations, s.currentId)
    return { conversations }
  }),

  addAssistantMessage: (content) => set((s) => {
    if (!s.currentId) return {}
    const conversations = s.conversations.map((c) =>
      c.id === s.currentId ? { ...c, messages: [...c.messages, { role: 'assistant' as const, content }], updatedAt: Date.now() } : c
    )
    persist(conversations, s.currentId)
    return { conversations }
  }),

  getCurrentMessages: () => {
    const s = get()
    const cur = s.conversations.find((c) => c.id === s.currentId)
    return cur?.messages ?? []
  },
}))

