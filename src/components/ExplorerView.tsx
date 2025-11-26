import { Group, Stack, Text, ScrollArea, UnstyledButton, Center, Skeleton, Button, Box } from '@mantine/core'
import { IconFile, IconFolder, IconChevronRight, IconChevronDown, IconRefresh, IconAlertTriangle } from '@tabler/icons-react'
import Editor from '@monaco-editor/react'
import { Profiler, useEffect, useState, useCallback } from 'react'
import TerminalPanel from './TerminalPanel'
import { getBackendClient } from '../lib/backend/bootstrap'
import { useTerminalStore } from '../store/terminal'
import { useTerminalTabs } from '../store/terminalTabs'
import { useExplorerHydration } from '../store/screenHydration'

interface FileTreeItemProps {
  name: string
  type: 'file' | 'folder'
  level: number
  path?: string
  isOpen?: boolean
  onToggle?: () => void
  onFileClick?: (path: string, name: string) => void
}

function FileTreeItem({ name, type, level, path, isOpen, onToggle, onFileClick }: FileTreeItemProps) {
  const handleClick = () => {
    if (type === 'folder') {
      onToggle?.()
    } else if (type === 'file' && path && onFileClick) {
      onFileClick(path, name)
    }
  }

  return (
    <UnstyledButton
      onClick={handleClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        paddingLeft: 8 + level * 16,
        width: '100%',
        color: '#cccccc',
        cursor: 'pointer',
        fontSize: '13px',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = '#2a2d2e'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      {type === 'folder' && (
        <>
          {isOpen ? (
            <IconChevronDown size={14} stroke={2} />
          ) : (
            <IconChevronRight size={14} stroke={2} />
          )}
          <IconFolder size={16} stroke={1.5} />
        </>
      )}
      {type === 'file' && (
        <>
          <div style={{ width: 14 }} />
          <IconFile size={16} stroke={1.5} />
        </>
      )}
      <Text size="sm">{name}</Text>
    </UnstyledButton>
  )
}


/**
 * Skeleton for Explorer while loading
 */
function ExplorerSkeleton() {
  return (
    <Group gap={0} style={{ flex: 1, height: '100%', overflow: 'hidden' }} align="stretch">
      {/* Sidebar skeleton */}
      <Box style={{ width: 260, backgroundColor: '#252526', borderRight: '1px solid #3e3e42', padding: 8 }}>
        <Skeleton width="100%" height={20} radius="sm" mb={12} />
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} width={`${70 + Math.random() * 30}%`} height={20} radius="sm" mb={4} ml={i % 3 * 16} />
        ))}
      </Box>
      {/* Editor skeleton */}
      <Box style={{ flex: 1, backgroundColor: '#1e1e1e', display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
        <Skeleton width={200} height={24} radius="sm" />
        <Skeleton width="100%" height="100%" radius="sm" />
      </Box>
    </Group>
  )
}

export default function ExplorerView() {
  // Screen hydration state
  const screenPhase = useExplorerHydration((s) => s.phase)
  const screenError = useExplorerHydration((s) => s.error)
  const startLoading = useExplorerHydration((s) => s.startLoading)
  const setReady = useExplorerHydration((s) => s.setReady)
  const setScreenError = useExplorerHydration((s) => s.setError)

  // Local explorer state (hydrated via WS RPC)
  const [openedFile, setOpenedFile] = useState<any>(null)
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [openFolders, setOpenFolders] = useState<string[]>([])
  const [childrenByDir, setChildrenByDir] = useState<Record<string, any[]>>({})

  // Get terminal tabs from store (not local state!)
  const explorerTerminalTabs = useTerminalTabs((s) => s.explorerTabs)
  const explorerActiveTerminal = useTerminalTabs((s) => s.explorerActive)
  const hydrateTabs = useTerminalTabs((s) => s.hydrateTabs)

  // Load explorer data
  const loadExplorer = useCallback(async () => {
    try {
      const client = getBackendClient()
      if (!client) throw new Error('No backend connection')

      // Load explorer state and tabs in parallel
      const [explorerRes] = await Promise.all([
        client.rpc('explorer.getState', {}),
        hydrateTabs(),
      ])

      if ((explorerRes as any)?.ok) {
        const res = explorerRes as any
        setWorkspaceRoot(res.workspaceRoot || null)
        setOpenFolders(Array.isArray(res.openFolders) ? res.openFolders : [])
        setChildrenByDir(res.childrenByDir || {})
        setOpenedFile(res.openedFile || null)
        setReady()
      } else {
        throw new Error('Failed to load explorer state')
      }
    } catch (e) {
      setScreenError(e instanceof Error ? e.message : 'Failed to load explorer')
    }
  }, [hydrateTabs, setReady, setScreenError])

  // Auto-load on mount
  // Note: We need to load every time the component mounts because local useState
  // resets on unmount, but the hydration store persists. So if phase is 'ready'
  // but workspaceRoot is null, we need to reload.
  useEffect(() => {
    if (screenPhase === 'idle') {
      startLoading()
      loadExplorer()
    } else if (screenPhase === 'ready' && workspaceRoot === null) {
      // Component remounted - local state was lost, reload silently
      loadExplorer()
    }
  }, [screenPhase, startLoading, loadExplorer, workspaceRoot])

  // Fit active explorer terminal when it changes and panel is open
  const fitTerminal = useTerminalStore((s) => s.fitTerminal)
  const explorerOpen = useTerminalStore((s) => s.explorerTerminalPanelOpen)
  useEffect(() => {
    if (!explorerOpen) return
    if (!explorerActiveTerminal) return
    const id = requestAnimationFrame(() => fitTerminal(explorerActiveTerminal))
    return () => cancelAnimationFrame(id)
  }, [explorerActiveTerminal, explorerOpen, fitTerminal])
  // When explorer tabs list changes, ensure each tab is fitted if panel is open
  useEffect(() => {
    if (!explorerOpen) return
    if (!explorerTerminalTabs || explorerTerminalTabs.length === 0) return
    const raf = requestAnimationFrame(() => explorerTerminalTabs.forEach((tid) => fitTerminal(tid)))
    return () => cancelAnimationFrame(raf)
  }, [explorerTerminalTabs, explorerOpen, fitTerminal])

  // Render a directory's entries recursively
  const renderDir = (dirPath: string, level: number) => {
    const entries = childrenByDir[dirPath] || []
    return entries.map((entry) => {
      if (entry.isDirectory) {
        const isOpen = openFolders.includes(entry.path)
        return (
          <div key={entry.path}>
            <FileTreeItem
              name={entry.name}
              type="folder"
              level={level}
              isOpen={isOpen}
              onToggle={async () => {
                try {
                  const res: any = await getBackendClient()?.rpc('explorer.toggleFolder', { path: entry.path })
                  if (res?.ok) {
                    setOpenFolders(Array.isArray(res.openFolders) ? res.openFolders : [])
                    setChildrenByDir(res.childrenByDir || {})
                  }
                } catch {}
              }}
            />
            {isOpen && <>{renderDir(entry.path, level + 1)}</>}
          </div>
        )
      }
      return (
        <FileTreeItem
          key={entry.path}
          name={entry.name}
          type="file"
          level={level}
          path={entry.path}
          onFileClick={handleFileClick}
        />
      )
    })
  }



  const handleFileClick = async (filePath: string, _fileName: string) => {
    try {
      const res: any = await getBackendClient()?.rpc('editor.openFile', { path: filePath })
      if (res?.ok && res.openedFile) setOpenedFile(res.openedFile)
    } catch {}
  }

  // Render based on screen phase
  if (screenPhase === 'idle' || screenPhase === 'loading') {
    return <ExplorerSkeleton />
  }

  if (screenPhase === 'error') {
    return (
      <Center h="100%">
        <Stack align="center" gap="md">
          <IconAlertTriangle size={48} color="var(--mantine-color-red-6)" />
          <Text size="sm" c="dimmed" ta="center">
            {screenError ?? 'Failed to load explorer'}
          </Text>
          <Button
            variant="light"
            size="sm"
            leftSection={<IconRefresh size={16} />}
            onClick={() => {
              startLoading()
              loadExplorer()
            }}
          >
            Retry
          </Button>
        </Stack>
      </Center>
    )
  }

  return (
    <Profiler
      id="ExplorerView"
      onRender={(_id, _phase, actualDuration) => {
        if (actualDuration > 16) {
        }
      }}
    >
      <Group
        gap={0}
        style={{
          flex: 1,
          height: '100%',
          overflow: 'hidden',
        }}
        align="stretch"
      >
      {/* File Tree Sidebar */}
      <div
        style={{
          width: 260,
          height: '100%',
          backgroundColor: '#252526',
          borderRight: '1px solid #3e3e42',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Sidebar Header */}
        <div
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid #3e3e42',
            backgroundColor: '#2d2d30',
          }}
        >
          <Text size="xs" fw={600} tt="uppercase" c="dimmed">
            Explorer
          </Text>
        </div>

        {/* File Tree */}
        <ScrollArea style={{ flex: 1 }}>
          <Stack gap={0} p="xs">
            {workspaceRoot ? (
              <>
                <FileTreeItem
                  name={(workspaceRoot.split(/[\/\\]/).pop() || workspaceRoot)}
                  type="folder"
                  level={0}
                  isOpen={openFolders.includes(workspaceRoot)}
                  onToggle={async () => {
                    const root = workspaceRoot
                    if (!root) return
                    try {
                      const res: any = await getBackendClient()?.rpc('explorer.toggleFolder', { path: root })
                      if (res?.ok) {
                        setOpenFolders(Array.isArray(res.openFolders) ? res.openFolders : [])
                        setChildrenByDir(res.childrenByDir || {})
                      }
                    } catch {}
                  }}
                />
                {openFolders.includes(workspaceRoot) && (
                  <>
                    {renderDir(workspaceRoot, 1)}
                  </>
                )}
              </>
            ) : (
              <Text size="sm" c="dimmed" p="md">
                No folder selected
              </Text>
            )}
          </Stack>
        </ScrollArea>
      </div>

      {/* Editor Area */}
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
        {/* Editor Tab Bar */}
        {openedFile && (
          <div
            style={{
              height: 35,
              backgroundColor: '#2d2d30',
              borderBottom: '1px solid #3e3e42',
              display: 'flex',
              alignItems: 'center',
              padding: '0 8px',
            }}
          >
            <div
              style={{
                padding: '6px 12px',
                backgroundColor: '#1e1e1e',
                borderRight: '1px solid #3e3e42',
                fontSize: '13px',
                color: '#ffffff',
              }}
            >
              {openedFile.path.split(/[/\\]/).pop()}
            </div>
          </div>
        )}

        {/* Monaco Editor + Terminal Panel (explorer context) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
            <Editor
              height="100%"
              language={openedFile?.language || 'typescript'}
              value={openedFile?.content || '// HiFide: Select a file to edit'}
              theme="vs-dark"
              options={{
                minimap: { enabled: true },
                fontSize: 14,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                readOnly: false,
              }}
            />
          </div>
          <div style={{ borderTop: '1px solid #3e3e42', flexShrink: 0 }}>
            <TerminalPanel context="explorer" />
          </div>
        </div>
      </div>
    </Group>
    </Profiler>
  )
}

