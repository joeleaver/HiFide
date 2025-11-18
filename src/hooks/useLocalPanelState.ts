import { useState, useEffect, useRef } from 'react'
import { getBackendClient } from '../lib/backend/bootstrap'

/**
 * Hook for managing panel UI state locally with debounced persistence to the store.
 * 
 * This pattern keeps UI state in the renderer for immediate responsiveness,
 * while still persisting to the main process store for session restoration.
 * 
 * @param initialValue - Initial value from the store
 * @param persistAction - Store action name to call for persistence
 * @param debounceMs - Debounce delay in milliseconds (default: 500)
 */
export function useLocalPanelState<T>(
  initialValue: T,
  persistAction: string,
  debounceMs: number = 500
): [T, (value: T) => void] {
  const [localValue, setLocalValue] = useState<T>(initialValue)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Update local state when initial value changes (e.g., on mount from persisted store)
  useEffect(() => {
    setLocalValue(initialValue)
  }, [initialValue])

  // Setter that updates local state immediately and debounces persistence
  const setValue = (value: T) => {
    setLocalValue(value)

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // Set new timeout for persistence
    timeoutRef.current = setTimeout(async () => {
      try {
        const client = getBackendClient(); if (!client) return
        await client.rpc('ui.updateWindowState', { updates: { [persistAction]: value } })
      } catch {}
    }, debounceMs)
  }

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return [localValue, setValue]
}

