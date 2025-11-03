/**
 * Shared UI payload cache for heavy tool results (main process only)
 * put/take semantics; not persisted.
 */

const _M = new Map<string, any>()

export const UiPayloadCache = {
  put(key: string, value: any) {
    try { _M.set(String(key), value) } catch {}
  },
  // Non-destructive read; returns the value without removing it
  peek<T = any>(key: string): T | undefined {
    try {
      const k = String(key)
      return _M.get(k) as T | undefined
    } catch {
      return undefined
    }
  },
  // Destructive read; removes the value after returning it
  take<T = any>(key: string): T | undefined {
    try {
      const k = String(key)
      const v = _M.get(k) as T | undefined
      _M.delete(k)
      return v
    } catch {
      return undefined
    }
  }
}

