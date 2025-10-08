import { Group, Stack, Text, ScrollArea, UnstyledButton } from '@mantine/core'
import { IconFile, IconFolder, IconChevronRight, IconChevronDown } from '@tabler/icons-react'
import Editor from '@monaco-editor/react'
import { useState, useEffect, useRef } from 'react'
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
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set())
  const [childrenByDir, setChildrenByDir] = useState<Record<string, Array<{ name: string; isDirectory: boolean; path: string }>>>({})
  const openedFile = useAppStore((s) => s.openedFile)
  const setOpenedFile = useAppStore((s) => s.setOpenedFile)
  const selectedFolder = useAppStore((s) => s.selectedFolder)

  const [watchId, setWatchId] = useState<number | null>(null)

  // Load a directory's entries
  const childrenRef = useRef(childrenByDir)
  useEffect(() => { childrenRef.current = childrenByDir }, [childrenByDir])

  const pendingDirsRef = useRef<Set<string>>(new Set())
  const timerRef = useRef<any>(null)

  const reloadDirWithDiff = async (dirPath: string) => {
    const prev = childrenRef.current[dirPath] || []
    const res = await window.fs!.readDir(dirPath)
    if (res?.success && Array.isArray(res.entries)) {
      const next = [...res.entries].sort((a: { name: string; isDirectory: boolean }, b: { name: string; isDirectory: boolean }) => (a.isDirectory !== b.isDirectory) ? (a.isDirectory ? -1 : 1) : a.name.localeCompare(b.name))
      setChildrenByDir((prevMap) => ({ ...prevMap, [dirPath]: next }))
      const prevSet = new Set(prev.map((e: { path: string }) => e.path))
      const nextSet = new Set(next.map((e: { path: string }) => e.path))
      const removed: string[] = []
      const added: string[] = []
      const removedDirs: string[] = []
      const addedDirs: string[] = []
      prev.forEach((e: { path: string; isDirectory: boolean }) => { if (!nextSet.has(e.path)) { removed.push(e.path); if (e.isDirectory) removedDirs.push(e.path) } })
      next.forEach((e: { path: string; isDirectory: boolean }) => { if (!prevSet.has(e.path)) { added.push(e.path); if (e.isDirectory) addedDirs.push(e.path) } })
      return { removed, added, removedDirs, addedDirs }
    }
    return { removed: [], added: [], removedDirs: [], addedDirs: [] }
  }
  const replacePrefixKeepingSep = (p: string, oldPrefix: string, newPrefix: string) => {
    if (p === oldPrefix) return newPrefix
    if (p.startsWith(oldPrefix + '\\')) return newPrefix + '\\' + p.slice(oldPrefix.length + 1)
    if (p.startsWith(oldPrefix + '/')) return newPrefix + '/' + p.slice(oldPrefix.length + 1)
    return p
  }

  const remapTreePaths = (oldDir: string, newDir: string) => {
    setOpenFolders((prev) => {
      const next = new Set<string>()
      for (const p of prev) {
        if (p === oldDir || p.startsWith(oldDir + '/') || p.startsWith(oldDir + '\\')) {
          next.add(replacePrefixKeepingSep(p, oldDir, newDir))
        } else {
          next.add(p)
        }
      }
      return next
    })
    setChildrenByDir((prev) => {
      const next: typeof prev = {}
      for (const [k, arr] of Object.entries(prev)) {
        const newKey = (k === oldDir || k.startsWith(oldDir + '/') || k.startsWith(oldDir + '\\'))
          ? replacePrefixKeepingSep(k, oldDir, newDir)
          : k
        const newArr = arr.map((e) => ({ ...e, path: replacePrefixKeepingSep(e.path, oldDir, newDir) }))
        next[newKey] = newArr
      }
      return next
    })
  }


  const scheduleDirReload = (dirPath: string) => {
    pendingDirsRef.current.add(dirPath)
    if (!timerRef.current) {
      timerRef.current = setTimeout(async () => {
        const dirs = Array.from(pendingDirsRef.current)
        pendingDirsRef.current.clear()
        timerRef.current = null
        const removedGlobal: string[] = []
        const addedGlobal: string[] = []
        const removedDirsGlobal: string[] = []
        const addedDirsGlobal: string[] = []
        for (const d of dirs) {
          try {
            const { removed, added, removedDirs, addedDirs } = await reloadDirWithDiff(d)
            removedGlobal.push(...removed)
            addedGlobal.push(...added)
            removedDirsGlobal.push(...removedDirs)
            addedDirsGlobal.push(...addedDirs)
          } catch {}
        }
        // Handle directory rename/move and keep expansion state
        const dirRemovedInfo = removedDirsGlobal.map(p => ({ path: p, parent: p.replace(/[\/\\][^\/\\]+$/, ''), name: p.split(/[\/\\]/).pop() || '' }))
        const dirAddedInfo = addedDirsGlobal.map(p => ({ path: p, parent: p.replace(/[\/\\][^\/\\]+$/, ''), name: p.split(/[\/\\]/).pop() || '' }))
        for (const r of dirRemovedInfo) {
          const candidateSameParent = dirAddedInfo.find(a => a.name === r.name && a.parent === r.parent)
          const candidateAny = candidateSameParent || dirAddedInfo.find(a => a.name === r.name)
          const candidate = candidateAny
          if (candidate) {
            remapTreePaths(r.path, candidate.path)
          }
        }

        // Handle open file rename/move/delete
        if (openedFile?.path) {
          const wasRemoved = removedGlobal.includes(openedFile.path)
          if (wasRemoved) {
            const newPath = addedGlobal.find(p => p.split(/[/\\]/).pop() === openedFile.path.split(/[/\\]/).pop()) || null
            if (newPath) {
              const name = newPath.split(/[/\\]/).pop() || ''
              await handleFileClick(newPath, name)
            } else {
              // Deleted: close the file gracefully
              setOpenedFile(null)
            }
          }
        }
      }, 150)
    }
  }

  const loadDir = async (dirPath: string) => {
    if (!window.fs) return
    try {
      const res = await window.fs.readDir(dirPath)
      if (res?.success && Array.isArray(res.entries)) {
        const entries = [...res.entries].sort((a: any, b: any) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        })
        setChildrenByDir((prev) => ({ ...prev, [dirPath]: entries }))
      }
    } catch {}
  }

  // Toggle folder open/closed and lazy-load contents when opening
  const onToggleFolder = async (dirPath: string) => {
    const isOpen = openFolders.has(dirPath)
    if (!isOpen && !childrenByDir[dirPath]) {
      await loadDir(dirPath)
    }
    setOpenFolders((prev) => {
      const next = new Set(prev)
      if (isOpen) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }

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
              onToggle={() => onToggleFolder(entry.path)}
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

  // Initialize when folder changes
  useEffect(() => {
    if (!selectedFolder) return
    setOpenFolders(new Set([selectedFolder]))
    loadDir(selectedFolder)
  }, [selectedFolder])

  // Start directory watch and handle events
  useEffect(() => {
    if (!selectedFolder || !window.fs) return

    let off: (() => void) | undefined
    let stopped = false

    const start = async () => {
      try {
        off = window.fs!.onWatch!((ev: { id: number; type: 'rename' | 'change'; path: string; dir: string }) => {
          if (!selectedFolder) return
          if (!ev?.path) return
          // Only respond to events under the selected folder
          if (!ev.path.startsWith(selectedFolder)) return

          // Reload the affected directory and its parent
          const parent = ev.path.replace(/[\/\\][^\/\\]+$/, '')
          scheduleDirReload(ev.dir)
          if (parent && parent !== ev.dir) scheduleDirReload(parent)

          // If the currently-opened file changed, reload its content immediately
          if (openedFile?.path && ev.type === 'change' && ev.path === openedFile.path) {
            const name = openedFile.path.split(/[\/\\]/).pop() || ''
            handleFileClick(openedFile.path, name)
          }
        })
        const res = await window.fs!.watchDir!(selectedFolder)
        if (!stopped && res?.success && typeof res.id === 'number') setWatchId(res.id)
      } catch {}
    }

    start()

    return () => {
      stopped = true
      try { off && off() } catch {}
      if (watchId != null) {
        try { window.fs!.unwatch!(watchId) } catch {}
        setWatchId(null)
      }
    }
  }, [selectedFolder, openedFile?.path])

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
                  name={(selectedFolder.split(/[\/\\]/).pop() || selectedFolder)}
                  type="folder"
                  level={0}
                  isOpen={openFolders.has(selectedFolder)}
                  onToggle={() => onToggleFolder(selectedFolder)}
                />
                {openFolders.has(selectedFolder) && (
                  <>
                    {renderDir(selectedFolder, 1)}
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

