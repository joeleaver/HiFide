import type { MainFlowContext } from './types'

export type Role = 'system' | 'user' | 'assistant'

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string; mimeType: string }

export interface Message {
  role: Role
  content: string | MessagePart[]
  // Allow extra provider-specific fields (e.g. reasoning)
  // without forcing them into MainFlowContext core type.
  [key: string]: any
}

export interface ContextManager {
  /** Get an immutable snapshot of the current main context */
  get(): MainFlowContext

  /** Append a single message to history */
  addMessage(message: Message): void

  /** Append multiple messages atomically */
  addMessages(messages: Message[]): void

  /** Replace system instructions */
  setSystemInstructions(text: string): void

  /** Set provider + model for this context */
  setProviderModel(provider: string, model: string): void

  /** Explicitly reset history (only when flows truly need it) */
  resetHistory(): void

  /** Apply arbitrary updates to the context */
  update(updates: Partial<MainFlowContext>): void

  /** Replace the entire history with a provided set of messages */
  replaceHistory(messages: Message[]): void
}

export function createContextManager(mainContextRef: { current: MainFlowContext }): ContextManager {
  const getSafeHistory = (ctx: MainFlowContext): Message[] =>
    Array.isArray(ctx.messageHistory) ? (ctx.messageHistory as Message[]) : []

  const snapshot = (): MainFlowContext => {
    const ctx = mainContextRef.current
    return {
      ...ctx,
      messageHistory: getSafeHistory(ctx),
    }
  }

  const commit = (updater: (ctx: MainFlowContext) => MainFlowContext) => {
    const next = updater(snapshot())
    mainContextRef.current = {
      ...next,
      contextType: next.contextType ?? 'main',
      messageHistory: getSafeHistory(next),
    }
  }

  return {
    get(): MainFlowContext {
      return snapshot()
    },

    addMessage(message: Message): void {
      commit((ctx) => ({
        ...ctx,
        messageHistory: [...getSafeHistory(ctx), message],
      }))
    },

    addMessages(messages: Message[]): void {
      if (!messages.length) return
      commit((ctx) => ({
        ...ctx,
        messageHistory: [...getSafeHistory(ctx), ...messages],
      }))
    },

    setSystemInstructions(text: string): void {
      commit((ctx) => ({
        ...ctx,
        systemInstructions: text,
      }))
    },

    setProviderModel(provider: string, model: string): void {
      commit((ctx) => ({
        ...ctx,
        provider,
        model,
      }))
    },

    resetHistory(): void {
      commit((ctx) => ({
        ...ctx,
        messageHistory: [],
      }))
    },

    update(updates: Partial<MainFlowContext>): void {
      if (!updates || Object.keys(updates).length === 0) return
      commit((ctx) => ({
        ...ctx,
        ...updates,
      }))
    },

    replaceHistory(messages: Message[]): void {
      const safeMessages = Array.isArray(messages)
        ? messages.map((msg) => ({ ...msg }))
        : []
      commit((ctx) => ({
        ...ctx,
        messageHistory: safeMessages,
      }))
    },
  }
}
