import { Box, Button, Center, Group, SegmentedControl } from '@mantine/core'
import { IconGitBranch } from '@tabler/icons-react'

import { DiffViewer, AnnotationEditor } from './sourceControl/DiffViewer'
import { SourceControlPane } from './sourceControl/SourceControlPane'
import { AttachToPromptButton } from './sourceControl/AttachToPromptButton'

import { CommitDetailsView } from './sourceControl/CommitDetailsView'
import { HistoryView } from './sourceControl/HistoryView'

import {
  selectSourceControlHeader,
  selectSourceControlHistoryViewModel,
  selectSourceControlViewModel,
  useSourceControlStore,
} from '@/store/sourceControl'

export default function SourceControlView() {
  const header = useSourceControlStore(selectSourceControlHeader)
  const vm = useSourceControlStore(selectSourceControlViewModel)
  const historyVm = useSourceControlStore(selectSourceControlHistoryViewModel)
  const selection = useSourceControlStore((s) => s.selection)
  const editingId = useSourceControlStore((s) => s.editingAnnotationId)
  const draft = useSourceControlStore((s) => s.editorDraft)
  const llmContextMode = useSourceControlStore((s) => s.llmContextMode)
  const activeTab = useSourceControlStore((s) => s.activeTab)
  const actions = useSourceControlStore((s) => s.actions)

  // IMPORTANT: never call hooks conditionally. This component previously called
  // `useSourceControlStore(...)` inside a conditional render branch which caused:
  // "Rendered more hooks than during the previous render" when switching tabs.
  const historyState = useSourceControlStore((s) => s.history)
  const commitDetails = useSourceControlStore((s) => s.commitDetails)
  const commitDetailsBusy = useSourceControlStore((s) => s.commitDetailsBusy)
  const commitDetailsError = useSourceControlStore((s) => s.commitDetailsError)

  const editingAnnotation = vm.annotationsForActiveFile.find((a) => a.id === editingId) ?? null

  const showPlaceholder = header.repos.length === 0

  // If there are no repos detected yet, still show the full Source Control shell
  // (changes list + diff area) so users can see the feature exists.
  // We reserve the “centered placeholder” only for true loading/empty-workspace states.
  if (showPlaceholder) {
    return (
      <Box style={{ flex: 1, height: '100%', backgroundColor: '#1e1e1e', display: 'flex', minHeight: 0 }}>
        <SourceControlPane files={[]} activePath={null} onSelectFile={() => {}}>
          <Box style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <Box style={{ padding: 10, borderBottom: '1px solid #2a2a2a', background: '#1f1f1f' }}>
              <Group justify="space-between" align="center">
                <Group gap={8} align="center">
                  <IconGitBranch size={16} />
                  <Box>
                    <div style={{ fontWeight: 600 }}>{header.title}</div>
                    <div style={{ fontSize: 12 }}>{header.subtitle}</div>
                  </Box>
                </Group>
              </Group>
            </Box>

            <Center style={{ flex: 1, color: '#888' }}>
              <Box style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 600 }}>No repositories detected</div>
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  Open a folder containing a git repo (a <code>.git</code> directory), then reopen Source Control.
                </div>
                <Group justify="center" mt="md">
                  <Button size="xs" variant="light" onClick={() => void actions.initRepoInWorkspace()}>
                    Initialize repository
                  </Button>
                </Group>
              </Box>
            </Center>
          </Box>
        </SourceControlPane>
      </Box>
    )
  }

  return (
    <Box style={{ flex: 1, height: '100%', backgroundColor: '#1e1e1e', display: 'flex', minHeight: 0 }}>
      <SourceControlPane
        files={vm.files}
        groups={vm.groups}
        activePath={vm.activePath}
        onSelectFile={(path) => void actions.selectFile(path)}
      >
        <Box style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Box style={{ padding: 10, borderBottom: '1px solid #2a2a2a', background: '#1f1f1f' }}>
            <Group justify="space-between" align="center">
              <SegmentedControl
                size="xs"
                value={activeTab}
                onChange={(v) => actions.setActiveTab(v as typeof activeTab)}
                data={[
                  { label: 'Changes', value: 'changes' },
                  { label: 'History', value: 'history' },
                ]}
              />
              {activeTab === 'changes' ? (
                <Group gap={8}>
                  <SegmentedControl
                    size="xs"
                    value={llmContextMode}
                    onChange={(v) => actions.setLlmContextMode(v as typeof llmContextMode)}
                    data={[
                      { label: 'None', value: 'none' },
                      { label: 'Selected file', value: 'selectedFile' },
                      { label: 'Annotated', value: 'annotated' },
                    ]}
                  />
                  <AttachToPromptButton onAttach={() => actions.attachDiffContextToNextPrompt()} />
                </Group>
              ) : null}
            </Group>
          </Box>

          <Box style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}>
            {activeTab === 'changes' ? (
              <Box style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                <DiffViewer
                  diff={vm.activeDiff}
                  annotations={vm.annotationsForActiveFile}
                  selected={selection}
                  onSelectHunk={actions.selectHunk}
                  onSelectLine={actions.selectLine}
                  onCreateHunkAnnotation={actions.createHunkAnnotation}
                  onCreateLineAnnotation={actions.createLineAnnotation}
                  onEditAnnotation={actions.startEditAnnotation}
                  onDeleteAnnotation={actions.deleteAnnotation}
                />
              </Box>
            ) : (
              <>
                <Box style={{ width: 420, borderRight: '1px solid #2a2a2a', minHeight: 0 }}>
                  <HistoryView
                    commits={historyState.commits}
                    graphRows={historyVm.graphRows}
                    selectedSha={historyState.selectedSha}
                    busy={historyState.busy}
                    error={historyState.error}
                    canLoadMore={!!historyState.cursor}
                    onLoadMore={actions.loadMoreLog}
                    onSelectCommit={actions.selectCommit}
                  />
                </Box>
                <Box style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                  <CommitDetailsView
                    details={commitDetails}
                    busy={commitDetailsBusy}
                    error={commitDetailsError}
                  />
                </Box>
              </>
            )}

            {activeTab === 'changes' ? (
              <Box style={{ width: 360, borderLeft: '1px solid #2a2a2a', background: '#252526', minHeight: 0 }}>
                <AnnotationEditor
                  annotation={editingAnnotation}
                  value={draft}
                  onChange={actions.setEditorDraft}
                  onSave={actions.saveEditorDraftToAnnotation}
                  onCancel={actions.cancelEditing}
                  onDelete={() => (editingAnnotation ? actions.deleteAnnotation(editingAnnotation.id) : undefined)}
                />
              </Box>
            ) : null}
          </Box>
        </Box>
      </SourceControlPane>
    </Box>
  )
}

