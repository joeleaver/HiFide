import { useEffect, useRef, useState } from 'react'
import { Box } from '@mantine/core'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

export default function TerminalView({ disableStdin = false }: { disableStdin?: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: 'Menlo, Consolas, monospace',
      fontSize: 12,
      cursorBlink: true,
      disableStdin,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    termRef.current = term
    fitRef.current = fit

    if (containerRef.current) {
      // Defer open until next frame to ensure the element is fully laid out
      requestAnimationFrame(() => {
        if (!containerRef.current) return
        try {
          term.open(containerRef.current)
        } catch {}
        // Defer initial fit to ensure layout has settled
        requestAnimationFrame(() => {
          try { fit.fit() } catch {}
          if (sessionId) {
            const { cols, rows } = term
            try { window.pty?.resize?.(sessionId, cols, rows) } catch {}
          }
        })
        // Observe container size changes and refit
        roRef.current = new ResizeObserver(() => {
          if (!fitRef.current || !termRef.current) return
          try { fitRef.current.fit() } catch {}
          if (sessionId) {
            const { cols, rows } = termRef.current
            try { window.pty?.resize?.(sessionId, cols, rows) } catch {}
          }
        })
        roRef.current.observe(containerRef.current)
      })
    }

    let cleanupSubs: Array<() => void> = []

    // Create PTY session and wire events
    const setup = async () => {
      let ptyId: string | null = null
      try {
        const res = await window.pty?.create?.({})
        if (!res?.sessionId) return
        ptyId = res.sessionId
      } catch (err: any) {
        // Surface a friendly message inside the terminal UI, but do not crash
        term.writeln('\r\n[Failed to start PTY: ' + (err?.message || String(err)) + ']')
        return
      }
      if (!ptyId) return
      setSessionId(ptyId)
      cleanupSubs.push(window.pty!.onData(({ sessionId: sid, data }) => {
        if (sid === ptyId) term.write(data)
      }))
      cleanupSubs.push(window.pty!.onExit(({ sessionId: sid, exitCode }) => {
        if (sid === ptyId) term.writeln(`\r\n[process exited with code ${exitCode}]`)
      }))
      if (!disableStdin) {
        term.onData((data) => {
          if (ptyId) window.pty?.write?.(ptyId, data)
        })
      }
      // Initial PTY resize after fit
      requestAnimationFrame(() => {
        const cols = term.cols
        const rows = term.rows
        if (ptyId) window.pty?.resize?.(ptyId, cols, rows)
      })
    }

    setup()

    const onResize = () => {
      if (!fitRef.current || !termRef.current) return
      fitRef.current.fit()
      if (sessionId) {
        const { cols, rows } = termRef.current
        window.pty?.resize?.(sessionId, cols, rows)
      }
    }

    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      if (roRef.current && containerRef.current) roRef.current.unobserve(containerRef.current)
      if (roRef.current) roRef.current.disconnect()
      cleanupSubs.forEach((fn) => fn())
      if (sessionId) {
        window.pty?.dispose?.(sessionId)
      }
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Box style={{ flex: 1, backgroundColor: '#1e1e1e', display: 'flex' }}>
      <div ref={containerRef} style={{ flex: 1 }} />
    </Box>
  )
}

