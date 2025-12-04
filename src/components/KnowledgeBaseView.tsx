import { useEffect, useMemo, useState, useRef } from 'react'
import { Button, Group, Stack, TextInput, TagsInput, Title, ScrollArea, Badge, Divider, Modal, Kbd, Center, Skeleton, Text, Box } from '@mantine/core'
import { getBackendClient } from '../lib/backend/bootstrap'
import { IconPlus, IconRefresh, IconAlertTriangle } from '@tabler/icons-react'
import { useKnowledgeBase } from '@/store/knowledgeBase'
import { useKnowledgeBaseHydration } from '@/store/screenHydration'


// MDX Editor (dark theme)
import '../styles/mdx-dark.css'
import { MDXEditor, MDXEditorMethods, UndoRedo, BoldItalicUnderlineToggles, BlockTypeSelect, ListsToggle, CodeToggle, toolbarPlugin, headingsPlugin, listsPlugin, quotePlugin, markdownShortcutPlugin, codeBlockPlugin, codeMirrorPlugin, InsertCodeBlock, ChangeCodeMirrorLanguage, ConditionalContents } from '@mdxeditor/editor'


// Supported code languages for MDXEditor CodeMirror integration
const KB_CODE_LANGUAGES = {
  ts: 'TypeScript',
  tsx: 'TypeScript (react)',
  js: 'JavaScript',
  jsx: 'JavaScript (react)',
  json: 'JSON',
  css: 'CSS',
  md: 'Markdown',
  markdown: 'Markdown',
  mdx: 'MDX',
  bash: 'Bash',
  sh: 'Shell',
  shell: 'Shell',
  powershell: 'PowerShell',
  ps: 'PowerShell',
  ps1: 'PowerShell',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  ini: 'INI',
  env: 'dotenv',
  dockerfile: 'Dockerfile',
  docker: 'Dockerfile',
  html: 'HTML',
  xml: 'XML',
  sql: 'SQL',
  diff: 'Diff',
  py: 'Python',
  python: 'Python',
  rb: 'Ruby',
  go: 'Go',
  rs: 'Rust',
  rust: 'Rust',
  cs: 'C#',
  csharp: 'C#',
  java: 'Java',
  kt: 'Kotlin',
  php: 'PHP',
  swift: 'Swift',
  c: 'C',
  cpp: 'C++',
  cxx: 'C++',
  h: 'C/C++ Header',
  txt: 'Plain Text',
  text: 'Plain Text',
  plaintext: 'Plain Text',
  plain: 'Plain Text'
} as const

const ALLOWED_CODE_LANG_SET = new Set(Object.keys(KB_CODE_LANGUAGES))

function sanitizeUnknownCodeFences(md: string): string {
  if (!md) return md
  const lines = md.split(/\r?\n/)
  let inFence = false
  let fenceMarker = '```'
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Support both backtick and tilde fences
    const m = line.match(/^(\s*)(```|~~~)(.*)$/)
    if (!m) continue
    const [, indent, marker, rest] = m
    const info = String(rest || '').trim()

    if (!inFence) {
      fenceMarker = marker
      if (!info) {
        // Unlabeled opening fence -> force txt
        lines[i] = `${indent}${marker}txt`
      } else {
        const [lang, ...restTokens] = info.split(/\s+/)
        const key = (lang || '').toLowerCase()
        if (key && !ALLOWED_CODE_LANG_SET.has(key)) {
          const restStr = restTokens.join(' ').trim()
          lines[i] = `${indent}${marker}txt${restStr ? ` ${restStr}` : ''}`
        }
      }
      inFence = true
    } else {
      // Closing fence -> normalize to closing marker only
      lines[i] = `${indent}${fenceMarker}`
      inFence = false
    }
  }
  return lines.join('\n')
}

function sanitizeMarkdownForEditor(text: string): string {
  if (!text) return ''
  const norm = text.replace(/\r\n?/g, '\n')
  return sanitizeUnknownCodeFences(norm)
}

/**
 * Skeleton for Knowledge Base while loading
 */
function KnowledgeBaseSkeleton() {
  return (
    <Box style={{ display: 'flex', height: '100%', padding: 16, gap: 16 }}>
      {/* Sidebar skeleton */}
      <Box style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Skeleton width="100%" height={36} radius="sm" />
        <Skeleton width="100%" height={36} radius="sm" />
        <Skeleton width="100%" height={28} radius="sm" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} width="100%" height={40} radius="sm" />
        ))}
      </Box>
      {/* Editor skeleton */}
      <Box style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Skeleton width={200} height={32} radius="sm" />
        <Skeleton width="100%" height="100%" radius="sm" />
      </Box>
    </Box>
  )
}

export default function KnowledgeBaseView() {
  // Screen hydration state
  const screenPhase = useKnowledgeBaseHydration((s) => s.phase)
  const screenError = useKnowledgeBaseHydration((s) => s.error)
  const startLoading = useKnowledgeBaseHydration((s) => s.startLoading)
  const setReady = useKnowledgeBaseHydration((s) => s.setReady)

  // Get state from store (not local state!)
  const itemsMap = useKnowledgeBase((s) => s.itemsMap)
  const workspaceFiles = useKnowledgeBase((s) => s.workspaceFiles)
  const setWorkspaceFiles = useKnowledgeBase((s) => s.setWorkspaceFiles)
  const setLoading = useKnowledgeBase((s) => s.setLoading)
  const setItemsMap = useKnowledgeBase((s) => s.setItemsMap)

  const [searchResults, setSearchResults] = useState<any[]>([])
  const [query, setQuery] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [editTags, setEditTags] = useState<string[]>([])
  const [editFiles, setEditFiles] = useState<string[]>([])
  const [newFile, setNewFile] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerIndex, setPickerIndex] = useState(0)
  const editorRef = useRef<MDXEditorMethods | null>(null)

  // Mark screen as ready on mount - data is already loaded from snapshot
  useEffect(() => {
    if (screenPhase === 'idle') {
      // Transition idle → loading → ready
      startLoading()
      setReady()
    }
  }, [screenPhase, startLoading, setReady])


  // When search changes, trigger WS search
  useEffect(() => {
    const client = getBackendClient(); if (!client) return
    if (!query && (!tags || tags.length === 0)) { setSearchResults([]); return }
    setLoading(true)
    client.rpc('kb.search', { query, tags, limit: 50 }).then((res: any) => {
      if (res?.ok) setSearchResults(res.results || [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [query, tags])


  const items = useMemo(() => (Object.values(itemsMap || {}) as any[]).sort((a: any, b: any) => a.title.localeCompare(b.title)), [itemsMap])
  const list = query || tags.length ? searchResults : items

  const selected = selectedId ? itemsMap[selectedId] : null

  useEffect(() => {
    if (!selectedId) return
    if (!selected) return // Deleted or not yet present; another effect will clear
    setTitle(selected.title)
    setEditTags(selected.tags || [])
    const client = getBackendClient()
    if (!client) return
    client.rpc('kb.getItemBody', { id: selectedId }).then((res: any) => {
      if (!res || !res.ok) return
      const item = res.item || {}
      const meta = item?.meta || {}
      const body = typeof item.body === 'string'
        ? item.body
        : typeof item.description === 'string'
          ? item.description
          : ''
      const files = Array.isArray(meta?.files)
        ? meta.files
        : Array.isArray(item.files)
          ? item.files
          : []
      const safe = sanitizeMarkdownForEditor(body)
      setDescription(safe)
      setEditFiles(files)
      try {
        editorRef.current?.setMarkdown(safe)
      } catch (error) {
        console.error('Error updating editor:', error)
      }
    }).catch(() => {})
  }, [selectedId, selected])

  // Quick picker filtered files
  // If the currently selected item disappears (deleted), clear the editor
  useEffect(() => {
    if (selectedId && !itemsMap[selectedId]) {
      setSelectedId(null)
      setTitle('')
      setDescription('')
      setEditTags([])
      setEditFiles([])
      try { editorRef.current?.setMarkdown('') } catch {}
    }
  }, [itemsMap, selectedId])

  const filtered = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    if (!q) return workspaceFiles.slice(0, 200)
    const arr = workspaceFiles.filter((p: string) => p.toLowerCase().includes(q))
    return arr.slice(0, 200)
  }, [workspaceFiles, pickerQuery])

  useEffect(() => {
    if (pickerOpen) {
      if (!workspaceFiles.length) {
        const client = getBackendClient(); if (client) {
          client.rpc('kb.refreshWorkspaceFileIndex', {}).then((res: any) => {
            if (res?.ok) setWorkspaceFiles(res.files || [])
          }).catch(() => {})
        }
      }
      setPickerIndex(0)
    }
  }, [pickerOpen])



  // Render based on screen phase
  if (screenPhase === 'idle' || screenPhase === 'loading') {
    return <KnowledgeBaseSkeleton />
  }

  if (screenPhase === 'error') {
    return (
      <Center h="100%">
        <Stack align="center" gap="md">
          <IconAlertTriangle size={48} color="var(--mantine-color-red-6)" />
          <Text size="sm" c="dimmed" ta="center">
            {screenError ?? 'Failed to load knowledge base'}
          </Text>
          <Button
            variant="light"
            size="sm"
            leftSection={<IconRefresh size={16} />}
            onClick={() => {
              startLoading()
              useKnowledgeBase.getState().reloadIndex()
            }}
          >
            Retry
          </Button>
        </Stack>
      </Center>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', backgroundColor: '#1e1e1e', color: '#ddd' }}>
      {/* Left panel: search + list */}
      <div style={{ width: 360, borderRight: '1px solid #333', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Title order={4} c="#eee">Knowledge Base</Title>
            <Button size="xs" variant="light" onClick={() => {
              setSelectedId(null)
              setTitle('')
              setDescription('')
              setEditTags([])
              setEditFiles([])
              setNewFile('')
            }}>
              <IconPlus size={14} style={{ marginRight: 6 }} />
              New
            </Button>
          </div>
          <TextInput placeholder="Search" value={query} onChange={(e) => setQuery(e.currentTarget.value)} mt="sm" />
          <TagsInput placeholder="Filter tags" value={tags} onChange={setTags} mt="sm" />
        </div>
        <Divider />
        <ScrollArea style={{ flex: 1 }}>
          <Stack gap={0}>
            {list.map((it: any) => (
              <div key={it.id} onClick={() => setSelectedId(it.id)} style={{ padding: 8, cursor: 'pointer', backgroundColor: selectedId === it.id ? '#2a2a2a' : 'transparent', borderBottom: '1px solid #2a2a2a' }}>
                <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</div>
                <Group gap={4} mt={4}>
                  {(it.tags || []).map((t: string) => <Badge key={t} size="xs" color="gray" variant="light">{t}</Badge>)}
                </Group>
              </div>
            ))}
          </Stack>
        </ScrollArea>
      </div>

      {/* Right panel: editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Title order={4} c="#eee">{selected ? 'Edit Item' : 'New Item'}</Title>
          <Group>
            {selected && (
              <Button color="red" size="xs" onClick={async () => {
                const client = getBackendClient(); if (!client || !selected) return
                const id = selected.id
                const res = await client.rpc('kb.deleteItem', { id }).catch(() => null)
                if (res?.ok) {
                  const res2 = await client.rpc('kb.reloadIndex', {}).catch(() => null)
                  if (res2?.ok) setItemsMap(res2.items || {})
                  if (selectedId === id) setSelectedId(null)
                }
              }}>Delete</Button>
            )}
            <Button size="xs" onClick={async () => {
              const client = getBackendClient(); if (!client) return
              if (selected) {
                const res = await client.rpc('kb.updateItem', { id: selected.id, patch: { title, description, tags: editTags, files: editFiles } }).catch(() => null)
                if (res?.ok) {
                  const res2 = await client.rpc('kb.reloadIndex', {}).catch(() => null)
                  if (res2?.ok) setItemsMap(res2.items || {})
                }
              } else {
                const res = await client.rpc('kb.createItem', { title, description, tags: editTags, files: editFiles }).catch(() => null)
                if (res?.ok) {
                  const newId = res.id
                  const res2 = await client.rpc('kb.reloadIndex', {}).catch(() => null)
                  if (res2?.ok) setItemsMap(res2.items || {})
                  if (newId) setSelectedId(newId)
                }
              }
            }}>Save</Button>
          </Group>
        </div>
        <Divider />
        <div style={{ padding: 12, display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
          {/* Center: title + editor */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ width: '100%', marginBottom: 12 }}>
              <TextInput label="Title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <div data-theme="dark" style={{ height: '100%', overflow: 'auto' }}>
                <MDXEditor
                  key={selectedId || 'new'}
                  ref={editorRef}
                  className="kb-mdx-root"
                  contentEditableClassName="markdown-body kb-mdx-content"
                  markdown={description}
                  onChange={setDescription}
                  plugins={[
                    toolbarPlugin({
                      toolbarClassName: 'kb-mde-toolbar',
                      toolbarContents: () => (
                        <ConditionalContents
                          options={[
                            { when: (editor) => editor?.editorType === 'codeblock', contents: () => <ChangeCodeMirrorLanguage /> },
                            {
                              fallback: () => (
                                <>
                                  <UndoRedo />
                                  <BlockTypeSelect />
                                  <BoldItalicUnderlineToggles />
                                  <CodeToggle />
                                  <ListsToggle />
                                  <InsertCodeBlock />
                                </>
                              )
                            }
                          ]}
                        />
                      )
                    }),
                    headingsPlugin(),
                    listsPlugin(),
                    quotePlugin(),
                    markdownShortcutPlugin(),
                    /* Enable code blocks + syntax highlighting */
                    codeBlockPlugin({ defaultCodeBlockLanguage: 'txt' }),
                    codeMirrorPlugin({
                      codeBlockLanguages: KB_CODE_LANGUAGES
                    })
                  ]}
                />
              </div>
            </div>
          </div>
          <Divider orientation="vertical" />
          {/* Right: tags + related files */}
          <div style={{ width: 320, display: 'flex', flexDirection: 'column' }}>
            <TagsInput label="Tags" value={editTags} onChange={setEditTags} mb="md" />
            <Title order={6} c="#ccc" style={{ marginBottom: 6 }}>Related files</Title>
            <Group align="end" gap={8} mb="sm">
              <TextInput placeholder="src/path/file.ts" value={newFile} onChange={(e) => setNewFile(e.currentTarget.value)} style={{ flex: 1 }} />
              <Button size="xs" variant="light" onClick={() => {
                const v = newFile.trim()
                if (!v) return
                if (!editFiles.includes(v)) setEditFiles([...editFiles, v])
                setNewFile('')
              }}>Add</Button>
              <Button size="xs" onClick={() => { setPickerQuery(''); setPickerOpen(true) }}>Pick</Button>
        <Modal opened={pickerOpen} onClose={() => setPickerOpen(false)} size="lg" withCloseButton={false} centered>
          <div style={{ background: '#1e1e1e', color: '#ddd', borderRadius: 8 }}>
            <div style={{ padding: 8 }}>
              <Group justify="space-between" align="center">
                <TextInput
                  autoFocus
                  placeholder="Type to search files (VSCode style)"
                  value={pickerQuery}
                  onChange={(e) => { setPickerQuery(e.currentTarget.value); setPickerIndex(0) }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setPickerIndex((i) => Math.min(i + 1, filtered.length - 1)) }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); setPickerIndex((i) => Math.max(i - 1, 0)) }
                    else if (e.key === 'Enter') {
                      const sel = filtered[pickerIndex]
                      if (sel) {
                        if (!editFiles.includes(sel)) setEditFiles([...editFiles, sel])
                        setPickerOpen(false)
                        setPickerQuery('')
                      }
                    } else if (e.key === 'Escape') {
                      setPickerOpen(false)
                    }
                  }}
                  style={{ flex: 1 }}
                />
                <Kbd>↑</Kbd><Kbd>↓</Kbd><Kbd>Enter</Kbd>
              </Group>
            </div>
            <Divider />
            <ScrollArea style={{ maxHeight: 420 }}>
              <Stack gap={0}>
                {filtered.map((f: string, idx: number) => (
                  <div
                    key={f + idx}
                    onClick={() => {
                      if (!editFiles.includes(f)) setEditFiles([...editFiles, f])
                      setPickerOpen(false)
                      setPickerQuery('')
                    }}
                    onMouseEnter={() => setPickerIndex(idx)}
                    style={{
                      padding: '8px 12px',
                      backgroundColor: idx === pickerIndex ? '#2a2a2a' : 'transparent',
                      cursor: 'pointer',
                      borderBottom: '1px solid #2a2a2a',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                      fontSize: 12,
                    }}
                  >
                    {f}
                  </div>
                ))}
                {filtered.length === 0 && (
                  <div style={{ padding: 12, color: '#888' }}>No matches</div>
                )}
              </Stack>
            </ScrollArea>
          </div>
        </Modal>

            </Group>
            <ScrollArea style={{ flex: 1 }}>
              <Stack gap={6}>
                {editFiles.map((f, i) => (
                  <Group key={f + i} gap={6} justify="space-between" style={{ border: '1px solid #333', borderRadius: 6, padding: 6 }}>
                    <div style={{ fontSize: 12, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f}</div>
                    <Button size="xs" color="red" variant="subtle" onClick={() => setEditFiles(editFiles.filter((x) => x !== f))}>Remove</Button>
                  </Group>
                ))}
              </Stack>
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  )
}

