import { Group, Stack, Text, ScrollArea, UnstyledButton } from '@mantine/core'
import { IconFile, IconFolder, IconChevronRight, IconChevronDown } from '@tabler/icons-react'
import Editor from '@monaco-editor/react'
import { Profiler, useEffect, useState } from 'react'
import TerminalPanel from './TerminalPanel'
import { getBackendClient } from '../lib/backend/bootstrap'
import { useTerminalStore } from '../store/terminal'

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


export default function ExplorerView() {
  // Local explorer state (hydrated via WS RPC)
  const [openedFile, setOpenedFile] = useState<any>(null)
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [openFolders, setOpenFolders] = useState<string[]>([])
  const [childrenByDir, setChildrenByDir] = useState<Record<string, any[]>>({})
  // Local explorer terminal tabs (hydrated via WS) for parity and potential fit logic
  const [explorerTerminalTabs, setExplorerTerminalTabs] = useState<string[]>([])
  const [explorerActiveTerminal, setExplorerActiveTerminal] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const res: any = await getBackendClient()?.rpc('terminal.getTabs', {})
        if (res?.ok) {
          setExplorerTerminalTabs(Array.isArray(res.explorerTabs) ? res.explorerTabs : [])
          setExplorerActiveTerminal(res.explorerActive || null)
        }
      } catch {}
    })()
  }, [])

  // Subscribe to terminal tabs changes for this connection only
  useEffect(() => {
    const client = getBackendClient()
    if (!client) return
    const off = client.subscribe('terminal.tabs.changed', (p: any) => {
      try {
        setExplorerTerminalTabs(Array.isArray(p?.explorerTabs) ? p.explorerTabs : [])
        setExplorerActiveTerminal(p?.explorerActive || null)
      } catch {}
    })
    return () => { try { off?.() } catch {} }
  }, [])

  // Hydrate explorer state from backend snapshot
  useEffect(() => {
    const client = getBackendClient()
    if (!client) return
    ;(async () => {
      try {
        const res: any = await client.rpc('explorer.getState', {})
        if (res?.ok) {
          setWorkspaceRoot(res.workspaceRoot || null)
          setOpenFolders(Array.isArray(res.openFolders) ? res.openFolders : [])
          setChildrenByDir(res.childrenByDir || {})
          setOpenedFile(res.openedFile || null)
        }
      } catch {}
    })()
  }, [])

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

