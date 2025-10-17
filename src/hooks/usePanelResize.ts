import { useEffect, useRef } from 'react'

export function usePanelResize(params: {
  initialHeight: number
  setHeight: (n: number) => void
  min?: number
  max?: number
  onEnd?: () => void
  /**
   * Handle position: 'top' or 'bottom'
   * - 'bottom': drag down = increase height (chat panel)
   * - 'top': drag down = decrease height (debug panel)
   */
  handlePosition?: 'top' | 'bottom'
}) {
  const { initialHeight, setHeight, min = 150, max = 600, onEnd, handlePosition = 'bottom' } = params
  const isResizingRef = useRef(false)

  useEffect(() => {
    return () => {
      // Cleanup cursor/userSelect on unmount just in case
      if (isResizingRef.current) {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        isResizingRef.current = false
      }
    }
  }, [])

  const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault()
    isResizingRef.current = true
    const startY = e.clientY
    const startH = initialHeight

    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return
      // Calculate delta based on handle position
      // - bottom handle: drag down = increase height (positive dy)
      // - top handle: drag down = decrease height (negative dy)
      const dy = handlePosition === 'bottom'
        ? ev.clientY - startY
        : startY - ev.clientY
      const next = Math.min(max, Math.max(min, startH + dy))
      // Call setHeight immediately - it will handle debouncing if using useLocalPanelState
      setHeight(next)
    }

    const onUp = () => {
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)

      try { onEnd?.() } catch {}
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return { onMouseDown, isResizingRef }
}

