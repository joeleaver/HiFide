export async function create(opts?: { shell?: string; cwd?: string; cols?: number; rows?: number; env?: Record<string, string>; log?: boolean }) {
  return await window.pty!.create(opts)
}

export async function write(sessionId: string, data: string) {
  return await window.pty!.write(sessionId, data)
}

export async function resize(sessionId: string, cols: number, rows: number) {
  return await window.pty!.resize(sessionId, cols, rows)
}

export async function dispose(sessionId: string) {
  return await window.pty!.dispose(sessionId)
}

export function onData(listener: (payload: { sessionId: string; data: string }) => void) {
  return window.pty?.onData?.(listener) || (() => {})
}

export function onExit(listener: (payload: { sessionId: string; exitCode: number }) => void) {
  return window.pty?.onExit?.(listener) || (() => {})
}

