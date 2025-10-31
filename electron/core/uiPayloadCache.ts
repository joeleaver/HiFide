/**
 * Shared UI payload cache for heavy tool results (main process only)
 * put/take semantics; not persisted.
 */

const _M = new Map<string, any>()

export const UiPayloadCache = {
  put(key: string, value: any) {
    try { _M.set(String(key), value) } catch {}
  },
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

