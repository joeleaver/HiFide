import { Group, Stack, Text, Center, Skeleton, Button, Box, ActionIcon, Tooltip, SegmentedControl, Alert } from '@mantine/core'
import { IconRefresh, IconAlertTriangle, IconX } from '@tabler/icons-react'
import Editor from '@monaco-editor/react'
import { MDXEditor } from '@mdxeditor/editor'
import { Profiler, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ComponentProps, MouseEvent as ReactMouseEvent } from 'react'

import ExplorerContextMenu from './explorer/ExplorerContextMenu'
import ExplorerTree from './explorer/ExplorerTree'
import OpenFilesPane from './explorer/OpenFilesPane'
import TerminalPanel from './TerminalPanel'
import WorkspaceSearchPane from './explorer/WorkspaceSearchPane'
import { registerMonacoInstance, withMonaco } from '@/lib/editor/monacoInstance'
import { registerLspProviders } from '@/lib/lsp/providers'
import { markdownPlugins } from '@/lib/editor/markdownPlugins'
import { normalizeReferenceLinks } from '@/lib/editor/markdownLinkNormalizer'
import { useExplorerHydration } from '@/store/screenHydration'
import { useEditorStore, type EditorViewMode, type EditorTab, type EditorSelectionRange } from '@/store/editor'
import { useExplorerStore } from '@/store/explorer'
import { reloadExplorerScreen } from '@/store/explorerScreenController'
import { useLanguageSupportStore } from '@/store/languageSupport'

import './ExplorerView.css'

type MonacoBeforeMount = Parameters<NonNullable<ComponentProps<typeof Editor>['beforeMount']>>[0]
type MonacoOnMountEditor = Parameters<NonNullable<ComponentProps<typeof Editor>['onMount']>>[0]

function resolveTabLanguageId(tab: EditorTab | null): string | null {
  if (!tab) return null
  const lowerPath = tab.path?.toLowerCase?.() ?? ''
  if (lowerPath.endsWith('.tsx')) return 'typescriptreact'
  if (lowerPath.endsWith('.jsx')) return 'javascriptreact'
  if (lowerPath.endsWith('.py')) return 'python'
  if (lowerPath.endsWith('.yaml') || lowerPath.endsWith('.yml')) return 'yaml'
  return (tab.language ?? '').toLowerCase() || null
}

function toMonacoLanguageId(languageId: string | null | undefined): string {
  const normalized = languageId?.toLowerCase?.() ?? ''
  if (normalized === 'typescriptreact') return 'typescript'
  if (normalized === 'javascriptreact') return 'javascript'
  return normalized || 'plaintext'
}

function ExplorerSkeleton() {
  return (
    <Group gap={0} style={{ flex: 1, height: '100%', overflow: 'hidden' }} align="stretch">
      <Box style={{ width: 260, backgroundColor: '#252526', borderRight: '1px solid #3e3e42', padding: 8 }}>
        <Skeleton width="100%" height={20} radius="sm" mb={12} />
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} width={`${70 + Math.random() * 30}%`} height={20} radius="sm" mb={4} ml={i % 3 * 16} />
        ))}
      </Box>
      <Box style={{ flex: 1, backgroundColor: '#1e1e1e', display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
        <Skeleton width={200} height={24} radius="sm" />
        <Skeleton width="100%" height="100%" radius="sm" />
      </Box>
    </Group>
  )
}

export default function ExplorerView() {
  const screenPhase = useExplorerHydration((s) => s.phase)
  const screenError = useExplorerHydration((s) => s.error)

  const sidebarWidth = useExplorerStore((s) => s.sidebarWidth)
  const setSidebarWidth = useExplorerStore((s) => s.setSidebarWidth)
  const openFilesPaneHeight = useExplorerStore((s) => s.openFilesPaneHeight)
  const setOpenFilesPaneHeight = useExplorerStore((s) => s.setOpenFilesPaneHeight)
  const sidebarMode = useExplorerStore((s) => s.sidebarMode)
  const setSidebarMode = useExplorerStore((s) => s.setSidebarMode)
  const explorerError = useExplorerStore((s) => s.lastError)

  const editorTabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const setActiveTab = useEditorStore((s) => s.setActiveTab)
  const closeTab = useEditorStore((s) => s.closeTab)
  const updateTabContent = useEditorStore((s) => s.updateContent)
  const toggleMarkdownView = useEditorStore((s) => s.toggleMarkdownView)
  const editorError = useEditorStore((s) => s.lastError)

  const activeTab = editorTabs.find((tab) => tab.id === activeTabId) || null
  const activeLanguageId = useMemo(() => resolveTabLanguageId(activeTab), [activeTab])
  const activeLanguageStatus = useLanguageSupportStore(
    useCallback((state) => (activeLanguageId ? state.languages[activeLanguageId] : undefined), [activeLanguageId])
  )
  const autoInstallPreference = useLanguageSupportStore((state) => state.autoInstall)
  const installingLanguage = useLanguageSupportStore((state) => state.installingLanguage)
  const requestProvision = useLanguageSupportStore((state) => state.requestProvision)
  const enableAutoInstall = useLanguageSupportStore((state) => state.enableAutoInstall)
  const dismissLanguage = useLanguageSupportStore((state) => state.dismissLanguage)
  const dismissedActiveLanguage = useLanguageSupportStore(
    useCallback((state) => (activeLanguageId ? !!state.dismissed[activeLanguageId] : false), [activeLanguageId])
  )

  const editorRef = useRef<MonacoOnMountEditor | null>(null)
  const monacoLanguageId = useMemo(
    () => toMonacoLanguageId(activeLanguageId ?? activeTab?.language),
    [activeLanguageId, activeTab?.language]
  )
  const normalizedMarkdown = useMemo(
    () => normalizeReferenceLinks(activeTab?.content ?? ''),
    [activeTab?.content]
  )

  const showInstallPrompt = Boolean(
    activeLanguageId &&
      activeLanguageStatus &&
      activeLanguageStatus.status === 'disabled' &&
      activeLanguageStatus.autoInstallable &&
      !autoInstallPreference &&
      !dismissedActiveLanguage
  )

  const handleDismissLanguage = useCallback(
    (languageId: string | null) => {
      if (!languageId) return
      dismissLanguage(languageId)
    },
    [dismissLanguage]
  )

  const handleInstallLanguage = useCallback(
    async (languageId: string | null) => {
      if (!languageId) return
      await requestProvision(languageId, 'user')
    },
    [requestProvision]
  )

  const handleAlwaysInstall = useCallback(
    async (languageId: string | null) => {
      if (!languageId) return
      await enableAutoInstall(languageId)
    },
    [enableAutoInstall]
  )

  const isInstallingActiveLanguage = Boolean(
    activeLanguageId &&
      (installingLanguage === activeLanguageId || activeLanguageStatus?.status === 'installing')
  )

  const ensureMonacoLanguage = useCallback(
    (monacoInstance: MonacoBeforeMount, targetEditor?: MonacoOnMountEditor | null) => {
      if (!activeTab) return
      let model = targetEditor?.getModel?.() ?? null
      if (!model) {
        try {
          const uri = monacoInstance.Uri.parse(activeTab.uri)
          model = monacoInstance.editor.getModel(uri)
        } catch {
          model = null
        }
      }
      if (!model) return
      const currentLanguage = model.getLanguageId()
      if (currentLanguage !== monacoLanguageId) {
        monacoInstance.editor.setModelLanguage(model, monacoLanguageId)
      }
      try {
        const totalLines = model.getLineCount()
        const forceTokenize = (model as any).forceTokenization || (model as any).tokenization?.forceTokenization
        if (typeof forceTokenize === 'function') {
          forceTokenize.call(model, totalLines)
        }
      } catch {}
    },
    [activeTab, monacoLanguageId]
  )

  const handleBeforeMount = useCallback((monacoInstance: MonacoBeforeMount) => {
    registerMonacoInstance(monacoInstance)
    registerLspProviders(monacoInstance)
  }, [])

  const handleEditorMount = useCallback(
    (editorInstance: MonacoOnMountEditor, monacoInstance: MonacoBeforeMount) => {
      editorRef.current = editorInstance
      requestAnimationFrame(() => {
        editorInstance.layout()
        ensureMonacoLanguage(monacoInstance, editorInstance)
      })
    },
    [ensureMonacoLanguage]
  )

  const pendingReveal = useEditorStore(
    useCallback(
      (state) => (state.activeTabId ? state.pendingReveals[state.activeTabId] ?? null : null),
      []
    )
  )
  const consumePendingReveal = useEditorStore((s) => s.consumePendingReveal)

  useEffect(() => {
    if (!activeTab) return
    withMonaco((monacoInstance) => {
      ensureMonacoLanguage(monacoInstance, editorRef.current)
      requestAnimationFrame(() => {
        editorRef.current?.layout()
      })
    })
  }, [activeTab, monacoLanguageId, ensureMonacoLanguage])

  useEffect(() => {
    if (!pendingReveal || !activeTabId) return
    const editorInstance = editorRef.current
    if (!editorInstance) return
    editorInstance.setSelection(pendingReveal as EditorSelectionRange)
    editorInstance.revealRangeInCenter(pendingReveal as EditorSelectionRange)
    consumePendingReveal(activeTabId)
  }, [pendingReveal, consumePendingReveal, activeTabId])

  useEffect(() => {
    requestAnimationFrame(() => {
      editorRef.current?.layout()
    })
  }, [sidebarWidth, openFilesPaneHeight])

  useEffect(() => () => {
    editorRef.current = null
  }, [])

  const handleSidebarResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const startX = event.clientX
      const startWidth = sidebarWidth

      const handleMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX
        setSidebarWidth(startWidth + delta)
      }

      const cleanup = () => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', cleanup)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', cleanup)
    },
    [sidebarWidth, setSidebarWidth]
  )


  const handleOpenFilesPaneResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const startY = event.clientY
      const startHeight = openFilesPaneHeight

      const handleMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientY - startY
        setOpenFilesPaneHeight(startHeight + delta)
      }

      const cleanup = () => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', cleanup)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', cleanup)
    },
    [openFilesPaneHeight, setOpenFilesPaneHeight]
  )

  if (screenPhase === 'idle' || screenPhase === 'loading') {
    return <ExplorerSkeleton />
  }

  if (screenPhase === 'error') {
    return (
      <Center h="100%">
        <Stack align="center" gap="md">
          <IconAlertTriangle size={48} color="var(--mantine-color-red-6)" />
          <Text size="sm" c="dimmed" ta="center">
            {screenError ?? explorerError ?? 'Failed to load explorer'}
          </Text>
          <Button
            variant="light"
            size="sm"
            leftSection={<IconRefresh size={16} />}
            onClick={() => {
              void reloadExplorerScreen()
            }}
          >
            Retry
          </Button>
        </Stack>
      </Center>
    )
  }

  return (
    <Profiler id="ExplorerView" onRender={() => {}}>
      <>
        <Group
          gap={0}
          style={{ flex: 1, height: '100%', overflow: 'hidden' }}
          align="stretch"
        >
          <div
            style={{
              width: sidebarWidth,
              minWidth: 180,
              maxWidth: 520,
              height: '100%',
              backgroundColor: '#252526',
              borderRight: '1px solid #3e3e42',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div className="explorer-sidebar-header">
              <SegmentedControl
                size="xs"
                value={sidebarMode}
                onChange={(value) => setSidebarMode(value as 'workspace' | 'search')}
                data={[
                  { label: 'Workspace', value: 'workspace' },
                  { label: 'Search', value: 'search' },
                ]}
                styles={{ root: { width: '100%' } }}
              />
            </div>
            <div className="explorer-sidebar-body">
              {sidebarMode === 'workspace' ? (
                <>
                  <div className="open-files-pane" style={{ flexShrink: 0, height: openFilesPaneHeight }}>
                    <div className="open-files-header">
                      <Text size="xs" fw={600} tt="uppercase" c="dimmed">
                        Open Files
                      </Text>
                      <Text size="xs" c="dimmed">
                        {editorTabs.length}
                      </Text>
                    </div>
                    <OpenFilesPane />
                  </div>
                  <div
                    role="separator"
                    aria-orientation="horizontal"
                    className="open-files-resizer"
                    onMouseDown={handleOpenFilesPaneResizeStart}
                  />
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <ExplorerTree />
                  </div>
                </>
              ) : (
                <WorkspaceSearchPane />
              )}
            </div>
          </div>

          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={handleSidebarResizeStart}
            style={{
              width: 4,
              cursor: 'col-resize',
              backgroundColor: '#2a2a2a',
              borderRight: '1px solid #1f1f1f',
              borderLeft: '1px solid #1f1f1f',
              flexShrink: 0,
            }}
          />

          <div
            style={{
              flex: 1,
              height: '100%',
              backgroundColor: '#1e1e1e',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                minHeight: 38,
                backgroundColor: '#2d2d30',
                borderBottom: '1px solid #3e3e42',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                paddingRight: 8,
              }}
            >
              {editorTabs.length > 0 ? (
                <div style={{ display: 'flex', gap: 6, padding: '0 8px', overflowX: 'auto', flex: 1 }}>
                  {editorTabs.map((tab) => {
                    const isActive = tab.id === activeTabId
                    return (
                      <div
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '6px 10px',
                          backgroundColor: isActive ? '#1e1e1e' : 'transparent',
                          borderRadius: 4,
                          border: isActive ? '1px solid #3e3e42' : '1px solid transparent',
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        <Tooltip label={tab.path} position="bottom-start" withinPortal>
                          <Text size="sm" c="#fff" style={{ whiteSpace: 'nowrap', fontStyle: tab.isPreview ? 'italic' : 'normal' }}>
                            {tab.name}
                          </Text>
                        </Tooltip>
                        {tab.isDirty && <span style={{ color: '#f7c948', fontSize: 12 }}>•</span>}
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="gray"
                          onClick={(event) => {
                            event.stopPropagation()
                            closeTab(tab.id)
                          }}
                        >
                          <IconX size={12} />
                        </ActionIcon>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <Text size="sm" c="dimmed" px="md" style={{ flex: 1 }}>
                  Open a file to start editing
                </Text>
              )}

              {activeTab?.isMarkdown && (
                <SegmentedControl
                  size="xs"
                  value={activeTab.viewMode}
                  onChange={(value) => activeTab && toggleMarkdownView(activeTab.id, value as EditorViewMode)}
                  data={[
                    { label: 'Markdown', value: 'rich' },
                    { label: 'Source', value: 'source' },
                  ]}
                  styles={{ root: { flexShrink: 0 } }}
                />
              )}
            </div>

            {editorError && (
              <Alert color="red" variant="light" radius={0} py={8} px={12} styles={{ message: { color: '#fff' } }}>
                {editorError}
              </Alert>
            )}

            {showInstallPrompt && activeLanguageStatus && activeLanguageId && (
              <Alert color="blue" variant="light" radius={0} py={8} px={12} styles={{ message: { color: '#e0f2ff' } }}>
                <Group justify="space-between" align="center">
                  <div>
                    <Text size="sm" fw={600} c="#fff">
                      Enable {activeLanguageStatus.displayName} language tools
                    </Text>
                    <Text size="xs" c="var(--mantine-color-blue-1)">
                      We can download {activeLanguageStatus.masonPackage ?? 'its language server'} automatically so completions and diagnostics work in this tab.
                    </Text>
                  </div>
                  <Group gap="xs">
                    <Button size="xs" loading={isInstallingActiveLanguage} onClick={() => handleInstallLanguage(activeLanguageId)}>
                      Install support
                    </Button>
                    <Button size="xs" variant="light" color="gray" onClick={() => handleAlwaysInstall(activeLanguageId)}>
                      Always auto-install
                    </Button>
                    <Button size="xs" variant="subtle" color="gray" onClick={() => handleDismissLanguage(activeLanguageId)}>
                      Not now
                    </Button>
                  </Group>
                </Group>
              </Alert>
            )}

            {activeLanguageStatus && activeLanguageStatus.status === 'installing' && (
              <Alert color="blue" variant="light" radius={0} py={6} px={12} styles={{ message: { color: '#e0f2ff' } }}>
                <Text size="xs" c="#e0f2ff">
                  Installing {activeLanguageStatus.displayName} language tools…
                </Text>
              </Alert>
            )}

            {activeLanguageStatus && activeLanguageStatus.status === 'error' && (
              <Alert color="red" variant="light" radius={0} py={6} px={12} styles={{ message: { color: '#fff' } }}>
                <Text size="sm" fw={600} c="#fff">
                  {activeLanguageStatus.displayName} language tools failed to start
                </Text>
                {activeLanguageStatus.lastError && (
                  <Text size="xs" c="#fee2e2">
                    {activeLanguageStatus.lastError}
                  </Text>
                )}
              </Alert>
            )}

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
              <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                {activeTab ? (
                  activeTab.isMarkdown && activeTab.viewMode === 'rich' ? (
                    <div data-theme="dark" style={{ height: '100%', overflow: 'auto' }}>
                      <MDXEditor
                        key={`${activeTab.id}:${activeTab.viewMode}:${activeTab.lastLoadedAt}`}
                        markdown={normalizedMarkdown}
                        onChange={(value) => updateTabContent(activeTab.id, value)}
                        contentEditableClassName="markdown-body kb-mdx-content"
                        className="kb-mdx-root"
                        plugins={markdownPlugins}
                      />
                    </div>
                  ) : (
                    <Editor
                      height="100%"
                      language={monacoLanguageId}
                      path={activeTab.uri}
                      value={activeTab.content}
                      theme="vs-dark"
                      beforeMount={handleBeforeMount}
                      onMount={handleEditorMount}
                      onChange={(value) => updateTabContent(activeTab.id, value ?? '')}
                      options={{
                        minimap: { enabled: true },
                        fontSize: 14,
                        lineNumbers: 'on',
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        smoothScrolling: true,
                        tabSize: 2,
                      }}
                    />
                  )
                ) : (
                  <Center h="100%">
                    <Stack align="center" gap="xs">
                      <Text size="sm" c="dimmed" ta="center">
                        Select a file from the explorer to start editing.
                      </Text>
                    </Stack>
                  </Center>
                )}
              </div>
              <div style={{ borderTop: '1px solid #3e3e42', flexShrink: 0 }}>
                <TerminalPanel />
              </div>
            </div>
          </div>
        </Group>
        <ExplorerContextMenu />
      </>
    </Profiler>
  )
}
