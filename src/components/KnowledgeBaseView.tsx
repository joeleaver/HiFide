import { useEffect, useMemo, useState, useRef } from 'react'
import { Button, Group, Stack, TextInput, TagsInput, Title, ScrollArea, Badge, Divider, Modal, Kbd } from '@mantine/core'
import { useAppStore, useDispatch } from '../store'

// MDX Editor (dark theme)
import '../styles/mdx-dark.css'
import { MDXEditor, MDXEditorMethods, UndoRedo, BoldItalicUnderlineToggles, BlockTypeSelect, ListsToggle, CodeToggle, toolbarPlugin, headingsPlugin, listsPlugin, quotePlugin, markdownShortcutPlugin, codeBlockPlugin, codeMirrorPlugin, InsertCodeBlock, ChangeCodeMirrorLanguage, ConditionalContents } from '@mdxeditor/editor'

export default function KnowledgeBaseView() {
  const dispatch = useDispatch()
  const kbItems = useAppStore((s) => s.kbItems)
  const loading = useAppStore((s) => s.kbLoading)
  const searchResults = useAppStore((s) => s.kbSearchResults)
  const opResult = useAppStore((s) => s.kbOpResult)

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


  // Loaded body from main store for selected item
  const workspaceFiles = useAppStore((s) => s.kbWorkspaceFiles) || []

  const loadedBody = useAppStore((s) => (selectedId ? s.kbBodies?.[selectedId] : undefined))
  const loadedFiles = useAppStore((s) => (selectedId ? s.kbFiles?.[selectedId] : undefined))

  // Load index on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { dispatch('kbReloadIndex') }, [])

  // When search changes, trigger search
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { dispatch('kbSearch', { query, tags }) }, [query, tags])

  // When creating a new item completes, select it
  useEffect(() => {
    if (opResult?.ok && opResult.op === 'create' && opResult.id) {
      setSelectedId(opResult.id)
      dispatch('kbClearOpResult')
    }
  }, [opResult])

  const items = useMemo(() => (Object.values(kbItems || {}) as any[]).sort((a: any, b: any) => a.title.localeCompare(b.title)), [kbItems])
  const list = query || tags.length ? searchResults : items

  const selected = selectedId ? kbItems[selectedId] : null

  useEffect(() => {
    if (!selectedId) return
    if (selected) {
      setTitle(selected.title)
      setEditTags(selected.tags || [])
    }
    dispatch('kbReadItemBody', { id: selectedId })
  }, [selectedId])

  // Quick picker filtered files
  const filtered = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    if (!q) return workspaceFiles.slice(0, 200)
    const arr = workspaceFiles.filter((p: string) => p.toLowerCase().includes(q))
    return arr.slice(0, 200)
  }, [workspaceFiles, pickerQuery])

  useEffect(() => {
    if (pickerOpen) {
      if (!workspaceFiles.length) dispatch('kbRefreshWorkspaceFileIndex')
      setPickerIndex(0)
    }
  }, [pickerOpen])

  // Hydrate files when loaded
  useEffect(() => {
    if (selectedId && loadedFiles) setEditFiles(loadedFiles)
  }, [selectedId, loadedFiles])

  // Hydrate description from loaded body when it changes
  useEffect(() => {
    if (!selectedId || loadedBody === undefined) return
    setDescription(loadedBody)
    try { editorRef.current?.setMarkdown(loadedBody || '') } catch {}
  }, [selectedId, loadedBody])

  return (
    <div style={{ display: 'flex', height: '100%', backgroundColor: '#1e1e1e', color: '#ddd' }}>
      {/* Left panel: search + list */}
      <div style={{ width: 360, borderRight: '1px solid #333', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 12 }}>
          <Title order={4} c="#eee">Knowledge Base</Title>
          <TextInput placeholder="Search" value={query} onChange={(e) => setQuery(e.currentTarget.value)} mt="sm" />
          <TagsInput placeholder="Filter tags" value={tags} onChange={setTags} mt="sm" />
          <Group mt="sm">
            <Button size="xs" onClick={() => dispatch('kbReloadIndex')} loading={loading}>Reload</Button>
            <Button size="xs" variant="light" onClick={() => {
              setSelectedId(null)
              setTitle('')
              setDescription('')
              setEditTags([])
              setEditFiles([])
              setNewFile('')
            }}>New</Button>
          </Group>
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
              <Button color="red" size="xs" onClick={() => selected && dispatch('kbDeleteItem', { id: selected.id })}>Delete</Button>
            )}
            <Button size="xs" onClick={() => {
              if (selected) {
                dispatch('kbUpdateItem', { id: selected.id, patch: { title, description, tags: editTags, files: editFiles } })
              } else {
                dispatch('kbCreateItem', { title, description, tags: editTags, files: editFiles })
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
                    codeBlockPlugin({ defaultCodeBlockLanguage: 'ts' }),
                    codeMirrorPlugin({
                      codeBlockLanguages: {
                        ts: 'TypeScript',
                        tsx: 'TypeScript (react)',
                        js: 'JavaScript',
                        json: 'JSON',
                        css: 'CSS',
                        md: 'Markdown'
                      }
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

