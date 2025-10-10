import { useAppStore } from './app'
import type { UseBoundStore, StoreApi } from 'zustand'
import type { Session, ChatMessage, TokenUsage } from './app'

// Re-export types from app store
export type { Session, ChatMessage, TokenUsage }

export type ChatState = {
  sessions: Session[]
  currentId: string | null
  sessionsLoaded: boolean
  loadSessions: () => Promise<void>
  saveCurrentSession: () => Promise<void>
  select: (id: string) => void
  newSession: (title?: string) => string
  rename: (id: string, title: string) => void
  remove: (id: string) => void
  addUserMessage: (content: string) => void
  addAssistantMessage: (content: string) => void
  getCurrentMessages: () => ChatMessage[]
  lastRequestTokenUsage: { provider: string; model: string; usage: TokenUsage } | null
  recordTokenUsage: (provider: string, model: string, usage: TokenUsage) => void
}

export const useChatStore = useAppStore as unknown as UseBoundStore<StoreApi<ChatState>>

