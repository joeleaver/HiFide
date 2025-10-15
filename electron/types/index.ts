/**
 * Shared type definitions for the Electron main process
 */


// Re-export provider types
export type { ProviderAdapter, AgentTool, ChatMessage, TokenUsage, StreamHandle } from '../providers/provider'

/**
 * PTY session information
 */
export interface PtySession {
  p: any // IPty instance (from @homebridge/node-pty-prebuilt-multiarch)
  wcId: number // WebContents ID
  log?: boolean // Whether to log this session
}

/**
 * File edit operation
 */
export interface FileEdit {
  path: string
  oldContent?: string
  newContent: string
  operation?: 'create' | 'update' | 'delete'
}

/**
 * Flow execution handle
 */
export interface FlowHandle {
  cancel: () => void
  paused?: boolean
  breakpoints?: Set<string>
}

/**
 * Stream handle for LLM requests
 */

/**
 * Window state for persistence
 */
export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

/**
 * Provider key names
 */
export type ProviderKeyName = 'openai' | 'anthropic' | 'gemini'

/**
 * Provider presence information
 */
export interface ProviderPresence {
  openai: boolean
  anthropic: boolean
  gemini: boolean
}

/**
 * Command risk assessment result
 */
export interface CommandRiskAssessment {
  risky: boolean
  reason?: string
}

/**
 * PTY logging event
 */
export interface PtyLogEvent {
  ts: string
  sessionId: string
  type: string
  [key: string]: any
}

/**
 * File system watch record
 */
export interface FileWatchRecord {
  close: () => void
}

/**
 * File system event
 */
export interface FileSystemEvent {
  id: number
  type: 'rename' | 'change'
  path: string
  dir: string
}

