/**
 * Shared constants for the application store
 * 
 * This file contains all constant values used across store slices,
 * particularly localStorage keys.
 */

// ============================================================================
// LocalStorage Keys
// ============================================================================

export const LS_KEYS = {
  // View
  CURRENT_VIEW: 'hifide:view',

  // UI State
  AGENT_MODE: 'hifide:agentMode',
  FLOW_CANVAS_COLLAPSED: 'hifide:flowCanvasCollapsed',
  FLOW_CANVAS_WIDTH: 'hifide:flowCanvasWidth',
  META_PANEL_OPEN: 'hifide:metaPanelOpen',
  SIDEBAR_COLLAPSED: 'hifide:sidebarCollapsed',
  DEBUG_PANEL_COLLAPSED: 'hifide:debugPanelCollapsed',
  DEBUG_PANEL_HEIGHT: 'hifide:debugPanelHeight',
  CHAT_PANEL_HEIGHT: 'hifide:chatPanelHeight',
  AGENT_TERMINAL_PANEL_OPEN: 'hifide:agentTerminalPanelOpen',
  AGENT_TERMINAL_PANEL_HEIGHT: 'hifide:agentTerminalPanelHeight',
  EXPLORER_TERMINAL_PANEL_OPEN: 'hifide:explorerTerminalPanelOpen',
  EXPLORER_TERMINAL_PANEL_HEIGHT: 'hifide:explorerTerminalPanelHeight',
  
  // Workspace
  WORKSPACE_ROOT: 'hifide:workspaceRoot',
  RECENT_FOLDERS: 'hifide:recentFolders',
  
  // Provider/Model
  SELECTED_MODEL: 'hifide:selectedModel',
  SELECTED_PROVIDER: 'hifide:selectedProvider',
  AUTO_RETRY: 'hifide:autoRetry',
  DEFAULT_MODELS: 'hifide:defaultModels',
  
  // Settings

  PRICING_CONFIG: 'hifide:pricingConfig',

  // Session
  CURRENT_SESSION_ID: 'hifide:currentSessionId',
  
  // Legacy (for migration)
  APP_STATE: 'hifide:app',
} as const

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULTS = {
  // View
  CURRENT_VIEW: 'agent' as const,

  // UI State
  AGENT_MODE: 'chat' as const,
  FLOW_CANVAS_COLLAPSED: false,
  FLOW_CANVAS_WIDTH: 600,
  META_PANEL_OPEN: false,
  SIDEBAR_COLLAPSED: false,
  DEBUG_PANEL_COLLAPSED: false,
  DEBUG_PANEL_HEIGHT: 300,
  CHAT_PANEL_HEIGHT: 400,
  AGENT_TERMINAL_PANEL_OPEN: false,
  AGENT_TERMINAL_PANEL_HEIGHT: 300,
  EXPLORER_TERMINAL_PANEL_OPEN: false,
  EXPLORER_TERMINAL_PANEL_HEIGHT: 300,
  
  // Provider/Model
  SELECTED_PROVIDER: 'openai',
  SELECTED_MODEL: 'gpt-4o',
  AUTO_RETRY: false,
  
  // Settings

  AUTO_ENFORCE_EDITS_SCHEMA: false,
  
  // Terminal
  TERMINAL_COLS: 80,
  TERMINAL_ROWS: 24,
} as const

// ============================================================================
// Other Constants
// ============================================================================

export const MAX_RECENT_FOLDERS = 10
export const MAX_DEBUG_LOGS = 1000
export const MAX_ROUTE_HISTORY = 100
export const MAX_SESSIONS = 100

// Terminal defaults
export const TERMINAL_COLS = 80
export const TERMINAL_ROWS = 24

