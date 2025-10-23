import { useRef, useLayoutEffect } from 'react'
import '@xterm/xterm/css/xterm.css'
import { useTerminalStore } from '../store/terminal'
import { useAppStore } from '../store'
import * as terminalInstances from '../services/terminalInstances'

export default function TerminalView({ tabId, context = 'explorer' }: { tabId: string; context?: 'agent' | 'explorer' }) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  // For agent terminals, get the session ID from the main store
  const currentId = useAppStore((s) => s.currentId)

  // Renderer-local terminal actions/state
  const mountTerminal = useTerminalStore((s) => s.mountTerminal)
  const fitTerminal = useTerminalStore((s) => s.fitTerminal)
  const trackedSessionId = useTerminalStore((s) => s.sessionIds[tabId])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    // For agent terminals, wait for a session to be loaded
    if (context === 'agent' && !currentId) {
      console.log('[TerminalView] Agent terminal but no currentId yet, skipping mount for:', tabId)
      return
    }

    let didMountOrBind = false

    const doMountOrBind = () => {
      const existing = terminalInstances.getTerminalInstance(tabId)
      if (existing) {
        terminalInstances.mountTerminalInstance(tabId, container)
        // Fit + sync PTY size
        fitTerminal(tabId)
      }

      // For agent terminals, use currentId as the session ID
      if (context === 'agent' && currentId && trackedSessionId !== currentId) {
        console.log('[TerminalView] (Re)attaching agent terminal:', { tabId, sessionId: currentId, trackedSessionId })
        void mountTerminal({ tabId, container, sessionId: currentId })
      }

      didMountOrBind = true
    }

    const visible = container.offsetWidth > 0 && container.offsetHeight > 0
    if (visible) {
      doMountOrBind()
    }

    const ro = new ResizeObserver(() => {
      const w = container.offsetWidth
      const h = container.offsetHeight
      if (w > 0 && h > 0) {
        if (!didMountOrBind) {
          doMountOrBind()
        } else {
          // Fit + sync PTY on subsequent resizes
          fitTerminal(tabId)
        }
      }
    })
    ro.observe(container)

    // On unmount, detach DOM and clean up subscribers (keep PTY alive in main)
    return () => {
      try { terminalInstances.unmountTerminalInstance(tabId) } catch {}
      try { ro.disconnect() } catch {}
    }
  }, [tabId, context, currentId, trackedSessionId, mountTerminal, fitTerminal])

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
