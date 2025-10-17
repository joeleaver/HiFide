/**
 * PTY Service (Main Process)
 * 
 * Re-exports from the IPC handler for use in store slices
 */

// PTY session management functions
// These are stubs for the main process - the terminal slice only runs in the renderer
// All PTY operations go through IPC handlers, not direct function calls

export async function create(_opts?: { shell?: string; cwd?: string; cols?: number; rows?: number; env?: Record<string, string>; log?: boolean }): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  return { ok: false, error: 'PTY operations not available in main process' }
}

export async function write(_sessionId: string, _data: string): Promise<{ ok: boolean }> {
  return { ok: false }
}

export async function resize(_sessionId: string, _cols: number, _rows: number): Promise<{ ok: boolean }> {
  return { ok: false }
}

export async function dispose(_sessionId: string): Promise<{ ok: boolean }> {
  return { ok: false }
}

// Event handlers - these need to be implemented differently in main process
export function onData(_listener: (payload: { sessionId: string; data: string }) => void) {
  // In main process, we don't use event emitters the same way
  // The terminal slice will handle this differently
  return () => {}
}

export function onExit(_listener: (payload: { sessionId: string; exitCode: number }) => void) {
  // In main process, we don't use event emitters the same way
  // The terminal slice will handle this differently
  return () => {}
}

// Agent PTY functions - these are implemented in the IPC handler
export async function attachAgent(_args: { requestId?: string; sessionId?: string; tailBytes?: number }): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  // In main process, we need to call the IPC handler logic directly
  // For now, return a stub - the actual implementation is in electron/ipc/pty.ts
  // The terminal slice only runs in renderer, so this should never be called
  return { ok: false, error: 'attachAgent not implemented in main process service layer' }
}

export async function detachAgent(_sessionId: string): Promise<{ ok: boolean }> {
  // In main process, we need to call the IPC handler logic directly
  // For now, return a stub - the actual implementation is in electron/ipc/pty.ts
  // The terminal slice only runs in renderer, so this should never be called
  return { ok: true }
}

