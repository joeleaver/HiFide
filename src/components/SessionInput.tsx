import { memo, useRef, useEffect } from 'react'
import { useUiStore } from '../store/ui'
import { useFlowRuntime } from '../store/flowRuntime'
import { FlowService } from '../services/flow'
import '../styles/mdx-dark.css'
import { MDXEditor, BoldItalicUnderlineToggles, ListsToggle, markdownShortcutPlugin, listsPlugin, toolbarPlugin, MDXEditorMethods } from '@mdxeditor/editor'

export default memo(function SessionInput() {
  const inputValue = useUiStore((s) => s.sessionInputValue || '')
  const setInputValue = useUiStore((s) => s.setSessionInputValue)
  const requestId = useFlowRuntime((s) => s.requestId)
  const editorRef = useRef<MDXEditorMethods | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const placeCaret = () => {
    try {
      requestAnimationFrame(() => {
        const root = containerRef.current?.querySelector('[contenteditable="true"]') as HTMLElement | null
        if (!root) return
        root.focus()
        const sel = window.getSelection()
        if (!sel) return
        const range = document.createRange()
        const last = root.lastChild
        if (last && last.nodeType === Node.TEXT_NODE) {
          range.setStart(last, (last.textContent || '').length)
        } else {
          range.setStart(root, root.childNodes.length)
        }
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
      })
    } catch {}
  }

  useEffect(() => {
    try {
      if (!inputValue) editorRef.current?.setMarkdown('\u00A0')
      editorRef.current?.focus(undefined, { defaultSelection: 'rootEnd' })
    } catch {}
    placeCaret()
  }, [])
  const send = async () => {
    const text = inputValue.trim()
    if (!text) return
    // Clear input, reset editor content, and resume flow via WebSocket JSON-RPC
    setInputValue('')
    try { editorRef.current?.setMarkdown('\u00A0') } catch {}
    placeCaret()

    // Get requestId from flowRuntime store
    if (!requestId) {
      console.warn('[SessionInput] No requestId available, cannot resume flow')
      return
    }

    await FlowService.resume(requestId, text).catch((e) => {
      console.error('[SessionInput] Failed to resume flow:', e)
    })
  }

  return (
    <div
      ref={containerRef}
      data-theme="dark"
      onKeyDownCapture={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          send()
        }
      }}
      onMouseDownCapture={() => {
        try { editorRef.current?.focus(undefined, { defaultSelection: 'rootEnd' }) } catch {}
        placeCaret()
      }}
      style={{ ['--kb-placeholder' as any]: '"Ask your agent... (Ctrl+Enter to send)"' }}
    >
      <MDXEditor
        ref={editorRef}
        className={`kb-mdx-root kb-session-input ${inputValue === '' ? 'is-empty' : ''}`}
        contentEditableClassName="markdown-body kb-mdx-content"
        markdown={inputValue === '' ? '' : inputValue}
        autoFocus={{ defaultSelection: 'rootEnd' }}
        onChange={(v) => {
          if (v === '') {
            setInputValue('')
            try { editorRef.current?.setMarkdown('\u00A0') } catch {}
            placeCaret()
            return
          }
          if (inputValue === '' && v.startsWith('\u00A0')) {
            setInputValue(v.slice(1))
            return
          }
          setInputValue(v)
        }}
        plugins={[
          toolbarPlugin({
            toolbarClassName: 'kb-mde-toolbar kb-mde-toolbar-compact',
            toolbarContents: () => (
              <>
                <BoldItalicUnderlineToggles options={['Bold', 'Italic']} />
                <ListsToggle options={['bullet', 'number']} />
              </>
            )
          }),
          listsPlugin(),
          markdownShortcutPlugin()
        ]}
      />
    </div>
  )
})
