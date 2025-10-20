import { useRef, useLayoutEffect } from 'react'
import '@xterm/xterm/css/xterm.css'
import { useTerminalStore } from '../store/terminal'
import { useAppStore } from '../store'

export default function TerminalView({ tabId, context = 'explorer' }: { tabId: string; context?: 'agent' | 'explorer' }) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  // For agent terminals, get the session ID from the main store
  const currentId = useAppStore((s) => s.currentId)

  // Get mount action and session tracking from terminal store
  const mountTerminal = useTerminalStore((s) => s.mountTerminal)
  const trackedSessionId = useTerminalStore((s) => s.sessionIds[tabId])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    // For agent terminals, wait for a session to be loaded
    if (context === 'agent' && !currentId) {
      console.log('[TerminalView] Agent terminal but no currentId yet, skipping mount for:', tabId)
      return
    }

    // For agent terminals, use currentId as the session ID
    // For explorer terminals, we'd need a different approach (not implemented yet)
    if (context === 'agent' && currentId) {
      // Only mount if we're not already tracking this session
      if (trackedSessionId !== currentId) {
        console.log('[TerminalView] Mounting agent terminal:', { tabId, sessionId: currentId, trackedSessionId })
        void mountTerminal({ tabId, container, sessionId: currentId })
      }
    }
  }, [tabId, context, currentId, mountTerminal, trackedSessionId])

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
