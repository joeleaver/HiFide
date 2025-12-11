/**
 * Store Module - Type Re-exports Only
 *
 * This module previously contained a Zustand store for the main process.
 * All state management has been migrated to Service classes.
 *
 * This file now only re-exports types for backward compatibility.
 * Services are the single source of truth for all application state.
 *
 * Architecture:
 * - Main process: Service classes (SessionService, WorkspaceService, etc.)
 * - Renderer: WebSocket JSON-RPC for communication + local Zustand stores for UI state
 */

// Re-export all types from types.ts for backward compatibility
export type {
  ViewType,
  SessionMessage,
  Session,
  SessionItem,
  NodeExecutionBox,
  Badge,
  TokenUsage,
  TokenCost,
  ModelOption,
  PtySession,
  PlanStep,
  ApprovedPlan,
  IndexStatus,
  IndexProgress,
  RouteRecord,
  ApiKeys,
  PricingConfig,
  DebugLogEntry,
  RecentFolder,
  ExplorerEntry,
  OpenedFile,
  ExplorerFsEvent,
  ExplorerFsEventKind,
  AgentMetrics,
  ActivityEvent,
  KanbanStatus,
  KanbanTask,
  KanbanEpic,
  KanbanBoard,
  FileWatchEvent,
  ContextRefreshResult,
} from './types.js'
