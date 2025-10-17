import { useEffect, useRef } from 'react'
import '@xterm/xterm/css/xterm.css'
import { useDispatch } from '../store'
import { getTerminalInstance } from '../services/terminalInstances'

export default function TerminalView({ tabId, context = 'explorer' }: { tabId: string; context?: 'agent' | 'explorer' }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mountedRef = useRef(false)
  const dispatch = useDispatch()

  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return

    const existingTerminal = getTerminalInstance(tabId)

    if (existingTerminal) {
      // Terminal already exists, just remount it to the new container
      dispatch('remountTerminal', { tabId, container: containerRef.current })
    } else {
      // Create new terminal
      dispatch('mountTerminal', { tabId, container: containerRef.current, context })
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
