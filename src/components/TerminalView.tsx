import { useRef, useLayoutEffect, useEffect, useState } from 'react'
import '@xterm/xterm/css/xterm.css'
import { useTerminalStore } from '../store/terminal'
import * as terminalInstances from '../services/terminalInstances'
import { getBackendClient } from '../lib/backend/bootstrap'

export default function TerminalView({ tabId, context = 'explorer' }: { tabId: string; context?: 'agent' | 'explorer' }) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  // For agent terminals, get the session ID from backend snapshot/notifications
  const [currentId, setCurrentId] = useState<string | null>(null)

  // Renderer-local terminal actions/state
  const mountTerminal = useTerminalStore((s) => s.mountTerminal)
  const fitTerminal = useTerminalStore((s) => s.fitTerminal)
  const trackedSessionId = useTerminalStore((s) => s.sessionIds[tabId])

  // Hydrate current session id and keep it fresh on timeline deltas
  useEffect(() => {
    const client = getBackendClient()
    if (!client) return
    ;(async () => {
      try {
        const cur: any = await client.rpc('session.getCurrent', {})
        setCurrentId(cur?.id || null)
      } catch {}
    })()
    const off = client.subscribe('session.timeline.delta', (p: any) => {
      if (p?.sessionId) setCurrentId(p.sessionId)
    })
    return () => { try { off?.() } catch {} }
  }, [])

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

      if (context === 'agent') {
        // For agent terminals, use currentId as the session ID
        if (currentId && trackedSessionId !== currentId) {
          console.log('[TerminalView] (Re)attaching agent terminal:', { tabId, sessionId: currentId, trackedSessionId })
          void mountTerminal({ tabId, container, context: 'agent', sessionId: currentId })
        }
      } else {
        // Explorer terminals: ensure a PTY exists for this tab
        if (!trackedSessionId) {
          console.log('[TerminalView] Mounting explorer terminal:', { tabId })
          void mountTerminal({ tabId, container, context: 'explorer' })
        } else if (!existing) {
          // Re-mount terminal instance for existing PTY session
          void mountTerminal({ tabId, container, context: 'explorer' })
        }
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
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#1e1e1e',
        paddingLeft: '12px',
        boxSizing: 'border-box',
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  )
}
