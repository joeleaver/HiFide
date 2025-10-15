import { Group, Stack, Text, ScrollArea, UnstyledButton } from '@mantine/core'
import { IconFile, IconFolder, IconChevronRight, IconChevronDown } from '@tabler/icons-react'
import Editor from '@monaco-editor/react'
import { Profiler } from 'react'
import { useAppStore, selectOpenedFile, selectWorkspaceRoot, selectExplorerOpenFolders, selectExplorerChildrenByDir, selectExplorerTerminalPanelOpen, selectExplorerTerminalPanelHeight } from '../store'
import TerminalPanel from './TerminalPanel'

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
  // Use selectors for better performance
  const openedFile = useAppStore(selectOpenedFile)
  const workspaceRoot = useAppStore(selectWorkspaceRoot)
  const openFolders = useAppStore(selectExplorerOpenFolders)
  const childrenByDir = useAppStore(selectExplorerChildrenByDir)
  const explorerTerminalPanelOpen = useAppStore(selectExplorerTerminalPanelOpen)
  const explorerTerminalPanelHeight = useAppStore(selectExplorerTerminalPanelHeight)

  // Actions only - these don't cause re-renders
  const toggleExplorerFolder = useAppStore((s) => s.toggleExplorerFolder)
  const openFile = useAppStore((s) => s.openFile)

  // Render a directory's entries recursively
  const renderDir = (dirPath: string, level: number) => {
    const entries = childrenByDir[dirPath] || []
    return entries.map((entry) => {
      if (entry.isDirectory) {
        const isOpen = openFolders.has(entry.path)
        return (
          <div key={entry.path}>
            <FileTreeItem
              name={entry.name}
              type="folder"
              level={level}
              isOpen={isOpen}
              onToggle={() => toggleExplorerFolder(entry.path)}
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
    try { await openFile(filePath) } catch {}
  }

  return (
    <Profiler
      id="ExplorerView"
      onRender={(id, phase, actualDuration) => {
        if (actualDuration > 16) {
          console.log(`[Profiler] ${id} ${phase}: ${actualDuration.toFixed(2)}ms`)
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
                  isOpen={openFolders.has(workspaceRoot)}
                  onToggle={() => toggleExplorerFolder(workspaceRoot)}
                />
                {openFolders.has(workspaceRoot) && (
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
          <div style={{
            flex: 1,
            overflow: 'hidden',
            minHeight: 0,
            height: explorerTerminalPanelOpen
              ? `calc(100% - ${explorerTerminalPanelHeight}px)`
              : 'calc(100% - 28px)'
          }}>
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

