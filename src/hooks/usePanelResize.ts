import { useEffect, useRef } from 'react'

export function usePanelResize(params: {
  getHeight: () => number
  setHeight: (n: number) => void
  min?: number
  max?: number
  onEnd?: () => void
}) {
  const { getHeight, setHeight, min = 150, max = 600, onEnd } = params
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
    const startH = getHeight()

    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return
      const dy = startY - ev.clientY
      const next = Math.min(max, Math.max(min, startH + dy))
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

