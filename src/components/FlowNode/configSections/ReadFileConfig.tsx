import { useMemo, useState } from 'react'
import { Text } from '@mantine/core'
import { useWorkspaceUi, type WorkspaceUiState } from '../../../store/workspaceUi'
import { useKnowledgeBase, type KnowledgeBaseStore } from '../../../store/knowledgeBase'

interface ReadFileConfigProps {
  config: any
  onConfigChange: (patch: any) => void
}

export function ReadFileConfig({ config, onConfigChange }: ReadFileConfigProps) {
  const workspaceRoot = useWorkspaceUi((s: WorkspaceUiState) => s.root)
  const workspaceFiles = useKnowledgeBase((s: KnowledgeBaseStore) => s.workspaceFiles)
  const refreshWorkspaceFiles = useKnowledgeBase((s: KnowledgeBaseStore) => s.refreshWorkspaceFiles)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerIndex, setPickerIndex] = useState(0)

  const filtered = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    if (!q) return workspaceFiles.slice(0, 200)
    return workspaceFiles.filter((p) => p.toLowerCase().includes(q)).slice(0, 200)
  }, [workspaceFiles, pickerQuery])

  const openPicker = () => {
    setPickerQuery('')
    setPickerIndex(0)
    setPickerOpen(true)
    if (!workspaceFiles.length) {
      void refreshWorkspaceFiles()
    }
  }

  const computeAndPatchEstimate = async (relPath: string) => {
    try {
      const root = (workspaceRoot || '').replace(/[\\/]+$/, '')
      const rel = (relPath || '').replace(/^[\\/]+/, '')
      const abs = `${root}/${rel}`
      const res = await (window as any).workspace.readFile(abs)
      if (res?.ok) {
        const tokens = Math.ceil((res.content?.length || 0) / 4)
        onConfigChange({ filePath: relPath, tokenEstimateTokens: tokens })
      } else {
        onConfigChange({ filePath: relPath })
      }
    } catch {
      onConfigChange({ filePath: relPath })
    }
  }

  return (
    <div style={sectionStyle}>
      <Text size="xs" c="dimmed" style={descriptionStyle}>
        📄 Reads a file from your workspace and outputs its contents via Data Out.
      </Text>
      <label style={fieldStyle}>
        <span style={labelStyle}>File path (workspace-relative):</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={config.filePath || ''}
            onChange={(e) => onConfigChange({ filePath: e.target.value })}
            placeholder="e.g., src/prompts/system.md"
            style={inputStyle}
          />
          <button className="nodrag" onClick={openPicker} style={buttonStyle}>
            Pick
          </button>
        </div>
        {!!config.tokenEstimateTokens && (
          <Text size="xs" c="dimmed" style={{ fontSize: 9 }}>
            ≈ {config.tokenEstimateTokens} tokens
          </Text>
        )}
      </label>

      {pickerOpen && (
        <div style={modalBackdrop} onClick={() => setPickerOpen(false)}>
          <div style={modalBody} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <input
                autoFocus
                type="text"
                placeholder="Type to search workspace files"
                value={pickerQuery}
                onChange={(e) => { setPickerQuery(e.currentTarget.value); setPickerIndex(0) }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setPickerIndex((i) => Math.min(i + 1, filtered.length - 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setPickerIndex((i) => Math.max(i - 1, 0))
                  } else if (e.key === 'Enter') {
                    const sel = filtered[pickerIndex]
                    if (sel) {
                      void computeAndPatchEstimate(sel)
                      setPickerOpen(false)
                      setPickerQuery('')
                    }
                  } else if (e.key === 'Escape') {
                    setPickerOpen(false)
                  }
                }}
                style={pickerInputStyle}
              />
            </div>
            <div style={modalList}>
              {filtered.map((f, idx) => (
                <div
                  key={`${f}-${idx}`}
                  onClick={() => { void computeAndPatchEstimate(f); setPickerOpen(false); setPickerQuery('') }}
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
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const sectionStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 8,
  marginBottom: 10,
  paddingBottom: 10,
  borderBottom: '1px solid #333'
}

const descriptionStyle = {
  fontSize: 9,
  lineHeight: 1.3
} as const

const fieldStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4
}

const labelStyle = {
  fontSize: 10,
  color: '#888',
  fontWeight: 600
} as const

const inputStyle = {
  flex: 1,
  padding: '4px 6px',
  background: '#252526',
  color: '#cccccc',
  border: '1px solid #3e3e42',
  borderRadius: 3,
  fontSize: 10,
}

const buttonStyle = {
  padding: '4px 8px',
  background: '#3e3e42',
  color: '#cccccc',
  border: '1px solid #555',
  borderRadius: 3,
  fontSize: 10,
  cursor: 'pointer'
}

const modalBackdrop = {
  position: 'fixed' as const,
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
}

const modalBody = {
  width: 720,
  maxHeight: 520,
  background: '#1e1e1e',
  border: '1px solid #333',
  borderRadius: 8,
  overflow: 'hidden'
}

const modalHeader = {
  padding: 8,
  display: 'flex',
  gap: 8,
  alignItems: 'center'
}

const pickerInputStyle = {
  flex: 1,
  padding: '4px 6px',
  background: '#252526',
  color: '#ccc',
  border: '1px solid #3e3e42',
  borderRadius: 4,
  fontSize: 12,
}

const modalList = {
  maxHeight: 420,
  overflow: 'auto'
}
