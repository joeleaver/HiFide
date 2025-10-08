import { Group, Stack, Text, ScrollArea, UnstyledButton } from '@mantine/core'
import { IconFile, IconFolder, IconChevronRight, IconChevronDown } from '@tabler/icons-react'
import Editor from '@monaco-editor/react'
import { useState } from 'react'
import { useAppStore } from '../store/app'
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

// Helper to detect language from file extension
function getLanguageFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    css: 'css',
    html: 'html',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    rb: 'ruby',
    sh: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    sql: 'sql',
  }
  return languageMap[ext || ''] || 'plaintext'
}

export default function ExplorerView() {
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set(['src']))
  const openedFile = useAppStore((s) => s.openedFile)
  const setOpenedFile = useAppStore((s) => s.setOpenedFile)
  const selectedFolder = useAppStore((s) => s.selectedFolder)

  const toggleFolder = (name: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  const handleFileClick = async (filePath: string, fileName: string) => {
    if (!window.fs) return

    const result = await window.fs.readFile(filePath)
    if (result.success && result.content) {
      const language = getLanguageFromFilename(fileName)
      setOpenedFile({
        path: filePath,
        content: result.content,
        language,
      })
    }
  }

  return (
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
            {selectedFolder ? (
              <>
                <FileTreeItem
                  name="src"
                  type="folder"
                  level={0}
                  isOpen={openFolders.has('src')}
                  onToggle={() => toggleFolder('src')}
                />
                {openFolders.has('src') && (
                  <>
                    <FileTreeItem
                      name="App.tsx"
                      type="file"
                      level={1}
                      path={`${selectedFolder}/src/App.tsx`}
                      onFileClick={handleFileClick}
                    />
                    <FileTreeItem
                      name="ChatPane.tsx"
                      type="file"
                      level={1}
                      path={`${selectedFolder}/src/ChatPane.tsx`}
                      onFileClick={handleFileClick}
                    />
                    <FileTreeItem
                      name="SettingsPane.tsx"
                      type="file"
                      level={1}
                      path={`${selectedFolder}/src/SettingsPane.tsx`}
                      onFileClick={handleFileClick}
                    />
                    <FileTreeItem
                      name="components"
                      type="folder"
                      level={1}
                      isOpen={openFolders.has('components')}
                      onToggle={() => toggleFolder('components')}
                    />
                    {openFolders.has('components') && (
                      <>
                        <FileTreeItem
                          name="ActivityBar.tsx"
                          type="file"
                          level={2}
                          path={`${selectedFolder}/src/components/ActivityBar.tsx`}
                          onFileClick={handleFileClick}
                        />
                        <FileTreeItem
                          name="AgentView.tsx"
                          type="file"
                          level={2}
                          path={`${selectedFolder}/src/components/AgentView.tsx`}
                          onFileClick={handleFileClick}
                        />
                        <FileTreeItem
                          name="ExplorerView.tsx"
                          type="file"
                          level={2}
                          path={`${selectedFolder}/src/components/ExplorerView.tsx`}
                          onFileClick={handleFileClick}
                        />
                        <FileTreeItem
                          name="Markdown.tsx"
                          type="file"
                          level={2}
                          path={`${selectedFolder}/src/components/Markdown.tsx`}
                          onFileClick={handleFileClick}
                        />
                        <FileTreeItem
                          name="StatusBar.tsx"
                          type="file"
                          level={2}
                          path={`${selectedFolder}/src/components/StatusBar.tsx`}
                          onFileClick={handleFileClick}
                        />
                      </>
                    )}
                    <FileTreeItem
                      name="store"
                      type="folder"
                      level={1}
                      isOpen={openFolders.has('store')}
                      onToggle={() => toggleFolder('store')}
                    />
                    {openFolders.has('store') && (
                      <>
                        <FileTreeItem
                          name="app.ts"
                          type="file"
                          level={2}
                          path={`${selectedFolder}/src/store/app.ts`}
                          onFileClick={handleFileClick}
                        />
                        <FileTreeItem
                          name="chat.ts"
                          type="file"
                          level={2}
                          path={`${selectedFolder}/src/store/chat.ts`}
                          onFileClick={handleFileClick}
                        />
                      </>
                    )}
                  </>
                )}
                <FileTreeItem
                  name="package.json"
                  type="file"
                  level={0}
                  path={`${selectedFolder}/package.json`}
                  onFileClick={handleFileClick}
                />
                <FileTreeItem
                  name="tsconfig.json"
                  type="file"
                  level={0}
                  path={`${selectedFolder}/tsconfig.json`}
                  onFileClick={handleFileClick}
                />
                <FileTreeItem
                  name="vite.config.ts"
                  type="file"
                  level={0}
                  path={`${selectedFolder}/vite.config.ts`}
                  onFileClick={handleFileClick}
                />
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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1 }}>
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
          <div style={{ borderTop: '1px solid #3e3e42' }}>
            <TerminalPanel context="explorer" />
          </div>
        </div>
      </div>
    </Group>
  )
}

