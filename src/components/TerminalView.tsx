import { useRef, useLayoutEffect } from 'react'
import '@xterm/xterm/css/xterm.css'
import { useTerminalStore } from '../store/terminal'
import { useTerminalTabs } from '../store/terminalTabs'
import * as terminalInstances from '../services/terminalInstances'

export default function TerminalView({ tabId }: { tabId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Renderer-local terminal actions/state
  const mountTerminal = useTerminalStore((s) => s.mountTerminal)
  const fitTerminal = useTerminalStore((s) => s.fitTerminal)
  const trackedSessionId = useTerminalStore((s) => s.sessionIds[tabId])
  const tabMetadata = useTerminalTabs((s) => s.explorerTabs.find((tab) => tab.id === tabId))

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    let didMountOrBind = false

    const doMountOrBind = () => {
      const existing = terminalInstances.getTerminalInstance(tabId)
      if (existing) {
        terminalInstances.mountTerminalInstance(tabId, container)
        // Fit + sync PTY size
        fitTerminal(tabId)
      }

      // Explorer terminals: ensure a PTY exists for this tab
      if (!trackedSessionId) {
        console.log('[TerminalView] Mounting explorer terminal:', { tabId })
        void mountTerminal({ tabId, container, context: 'explorer', cwd: tabMetadata?.cwd, shell: tabMetadata?.shell })
      } else if (!existing) {
        // Re-mount terminal instance for existing PTY session
        void mountTerminal({ tabId, container, context: 'explorer', cwd: tabMetadata?.cwd, shell: tabMetadata?.shell })
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
  }, [tabId, trackedSessionId, mountTerminal, fitTerminal, tabMetadata?.cwd, tabMetadata?.shell])

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
