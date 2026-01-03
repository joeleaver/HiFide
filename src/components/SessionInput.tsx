import { memo, useRef, useEffect, useState, useCallback } from 'react'
import { useUiStore } from '../store/ui'
import { useFlowRuntime } from '../store/flowRuntime'
import { FlowService } from '../services/flow'
import { Image, Group, Stack, Text, Paper, ActionIcon } from '@mantine/core'
import { IconPhoto, IconPlus, IconX } from '@tabler/icons-react'
import '../styles/mdx-dark.css'
import { MDXEditor, BoldItalicUnderlineToggles, CreateLink, InsertTable, ListsToggle, markdownShortcutPlugin, listsPlugin, toolbarPlugin, MDXEditorMethods, linkPlugin, linkDialogPlugin, tablePlugin } from '@mdxeditor/editor'

interface PendingImage {
  id: string
  dataUrl: string
  mimeType: string
  base64: string
}

export default memo(function SessionInput() {
  const inputValue = useUiStore((s) => s.sessionInputValue || '')
  const setInputValue = useUiStore((s) => s.setSessionInputValue)
  const inputContext = useUiStore((s) => s.sessionInputContext)
  const clearInputContext = useUiStore((s) => s.clearSessionInputContext)
  const requestId = useFlowRuntime((s) => s.requestId)
  
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [isDragging, setIsDragging] = useState(false)
  
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

  const handleFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = (e) => {
          const originalDataUrl = e.target?.result as string
          if (!originalDataUrl) return
          
          const img = new window.Image()
          img.onload = () => {
            // Anthropic and OpenAI recommend keeping images under 1568px for optimal token/detail balance.
            // Many models crash or consume excessive tokens if dimensions are too high.
            const MAX_WIDTH = 1568
            const MAX_HEIGHT = 1568
            let width = img.width
            let height = img.height

            if (width > MAX_WIDTH || height > MAX_HEIGHT) {
              const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height)
              width = Math.floor(width * ratio)
              height = Math.floor(height * ratio)
            }

            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height
            const ctx = canvas.getContext('2d')
            if (!ctx) return

            ctx.drawImage(img, 0, 0, width, height)
            
            // Using JPEG with 0.7 quality provides a significant reduction in payload size 
            // with minimal loss in model reasoning capabilities.
            // We always process through canvas to ensure a consistent, optimized format.
            const resizedDataUrl = canvas.toDataURL('image/jpeg', 0.7)
            const base64 = resizedDataUrl.split(',')[1]

            setPendingImages(prev => [
              ...prev,
              {
                id: Math.random().toString(36).substring(7),
                dataUrl: resizedDataUrl,
                mimeType: 'image/jpeg',
                base64
              }
            ])
          }
          img.src = originalDataUrl
        }
        reader.readAsDataURL(file)
      }
    })
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files)
    }
  }, [handleFiles])

  const onPaste = useCallback((e: React.ClipboardEvent) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      handleFiles(e.clipboardData.files)
    } else {
      // Check items for image data (e.g. from screenshot tool)
      const items = Array.from(e.clipboardData.items)
      const imageItems = items.filter(item => item.type.startsWith('image/'))
      if (imageItems.length > 0) {
        const files = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[]
        if (files.length > 0) {
          handleFiles(files)
        }
      }
    }
  }, [handleFiles])

  const removeImage = (id: string) => {
    setPendingImages(prev => prev.filter(img => img.id !== id))
  }

  const send = async () => {
    const text = inputValue.trim()
    if (!text && pendingImages.length === 0) return
    
    // Clear input, reset editor content, and resume flow via WebSocket JSON-RPC
    setInputValue('')
    setPendingImages([])
    clearInputContext()
    try { editorRef.current?.setMarkdown('\u00A0') } catch {}
    placeCaret()

    // Get requestId from flowRuntime store
    if (!requestId) {
      console.warn('[SessionInput] No requestId available, cannot resume flow')
      return
    }

    let finalInput: string | any[] = text
    if (pendingImages.length > 0) {
      const parts: any[] = []
      if (text) {
        parts.push({ type: 'text', text })
      }
      for (const img of pendingImages) {
        parts.push({
          type: 'image',
          image: img.base64,
          mimeType: img.mimeType
        })
      }
      finalInput = parts
    }

    await FlowService.resume(requestId, finalInput as any, { userInputContext: inputContext }).catch((e) => {
      console.error('[SessionInput] Failed to resume flow:', e)
    })
  }

  return (
    <Stack 
      gap="xs" 
      ref={containerRef}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPaste={onPaste}
      style={{ 
        position: 'relative',
        border: isDragging ? '2px dashed var(--mantine-color-blue-6)' : '2px solid transparent',
        borderRadius: '8px',
        transition: 'all 0.1s ease'
      }}
    >
      {pendingImages.length > 0 && (
        <Group gap="xs" px="sm" pt="xs">
          {pendingImages.map((img) => (
            <Paper 
              key={img.id} 
              pos="relative" 
              shadow="xs" 
              withBorder 
              p={2}
              style={{ overflow: 'hidden', borderRadius: '4px' }}
            >
              <Image src={img.dataUrl} h={60} w={60} fit="cover" radius="sm" />
              <ActionIcon 
                size="xs" 
                color="red" 
                variant="filled" 
                pos="absolute" 
                top={-4} 
                right={-4}
                onClick={() => removeImage(img.id)}
                style={{ borderRadius: '50%', zIndex: 1 }}
              >
                <IconX size={10} />
              </ActionIcon>
            </Paper>
          ))}
          <Paper
            withBorder
            p={0}
            h={60}
            w={60}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              cursor: 'pointer',
              borderStyle: 'dashed',
              backgroundColor: 'transparent'
            }}
            onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'image/*'
              input.multiple = true
              input.onchange = (e) => {
                const files = (e.target as HTMLInputElement).files
                if (files) handleFiles(files)
              }
              input.click()
            }}
          >
            <IconPlus size={20} stroke={1.5} color="gray" />
          </Paper>
        </Group>
      )}

      <div
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
                  <CreateLink />
                  <InsertTable />
                </>
              )
            }),
            listsPlugin(),
            tablePlugin(),
            markdownShortcutPlugin(),
            linkPlugin(),
            linkDialogPlugin()
          ]}
        />
      </div>

      {isDragging && (
        <div 
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(25, 113, 194, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 10,
            borderRadius: '8px'
          }}
        >
          <Group gap="xs">
            <IconPhoto size={24} color="var(--mantine-color-blue-6)" />
            <Text fw={500} c="blue.6">Drop images here</Text>
          </Group>
        </div>
      )}
    </Stack>
  )
})
