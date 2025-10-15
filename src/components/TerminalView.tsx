import { useEffect, useRef } from 'react'
import 'xterm/css/xterm.css'
import { useAppStore } from '../store'

export default function TerminalView({ tabId, context = 'explorer' }: { tabId: string; context?: 'agent' | 'explorer' }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return

    const { terminals, mountTerminal, remountTerminal } = useAppStore.getState()
    const existingTerminal = terminals[tabId]

    if (existingTerminal) {
      // Terminal already exists, just remount it to the new container
      remountTerminal(tabId, containerRef.current)
    } else {
      // Create new terminal
      mountTerminal(tabId, containerRef.current, context)
    }

    mountedRef.current = true

    // Don't unmount on cleanup - terminals persist until tab is closed
  }, [tabId, context])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#1e1e1e',
      }}
    />
  )
}
