import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  ActionIcon,
  Group,
  Text,
  Badge,
  Button,
  Checkbox,
  TextInput,
  Divider,
  Alert,
  Loader,
  ScrollArea,
  Stack,
  Tooltip,
} from '@mantine/core'
import { IconSearch, IconChevronDown, IconReplace } from '@tabler/icons-react'

import { useWorkspaceSearchStore, type LocalSearchMatch } from '@/store/workspaceSearch'
import type { WorkspaceSearchMatch } from '../../../shared/search'


interface SearchResultFileView {
  key: string
  path: string
  relativePath: string
  matches: LocalSearchMatch[]
  expanded: boolean
}

function renderMatchSnippet(match: WorkspaceSearchMatch) {
  const text = match.lineText ?? ''
  const startIndex = Math.max(0, (match.range.start.column || 1) - 1)
  const endIndex = Math.max(startIndex, (match.range.end.column || startIndex + 1) - 1)
  return (
    <>
      <span>{text.slice(0, startIndex)}</span>
      <span className="workspace-search-snippet-hit">{text.slice(startIndex, endIndex)}</span>
      <span>{text.slice(endIndex)}</span>
    </>
  )
}

export default function WorkspaceSearchPane() {
  const query = useWorkspaceSearchStore((s) => s.query)
  const replaceValue = useWorkspaceSearchStore((s) => s.replaceValue)
  const setQuery = useWorkspaceSearchStore((s) => s.setQuery)
  const setReplaceValue = useWorkspaceSearchStore((s) => s.setReplaceValue)
  const matchCase = useWorkspaceSearchStore((s) => s.matchCase)
  const setMatchCase = useWorkspaceSearchStore((s) => s.setMatchCase)
  const matchWholeWord = useWorkspaceSearchStore((s) => s.matchWholeWord)
  const setMatchWholeWord = useWorkspaceSearchStore((s) => s.setMatchWholeWord)
  const useRegex = useWorkspaceSearchStore((s) => s.useRegex)
  const setUseRegex = useWorkspaceSearchStore((s) => s.setUseRegex)
  const includeGlobsText = useWorkspaceSearchStore((s) => s.includeGlobsText)
  const setIncludeGlobsText = useWorkspaceSearchStore((s) => s.setIncludeGlobsText)
  const excludeGlobsText = useWorkspaceSearchStore((s) => s.excludeGlobsText)
  const setExcludeGlobsText = useWorkspaceSearchStore((s) => s.setExcludeGlobsText)
  const useIgnoreFiles = useWorkspaceSearchStore((s) => s.useIgnoreFiles)
  const setUseIgnoreFiles = useWorkspaceSearchStore((s) => s.setUseIgnoreFiles)
  const useGlobalIgnore = useWorkspaceSearchStore((s) => s.useGlobalIgnore)
  const setUseGlobalIgnore = useWorkspaceSearchStore((s) => s.setUseGlobalIgnore)
  const runSearch = useWorkspaceSearchStore((s) => s.runSearch)
  const cancelSearch = useWorkspaceSearchStore((s) => s.cancelSearch)
  const applySelectedReplacements = useWorkspaceSearchStore((s) => s.applySelectedReplacements)
  const replaceInFile = useWorkspaceSearchStore((s) => s.replaceInFile)
  const toggleFileExpanded = useWorkspaceSearchStore((s) => s.toggleFileExpanded)
  const toggleFileSelection = useWorkspaceSearchStore((s) => s.toggleFileSelection)
  const toggleMatchSelection = useWorkspaceSearchStore((s) => s.toggleMatchSelection)
  const selectAllMatches = useWorkspaceSearchStore((s) => s.selectAllMatches)
  const openMatch = useWorkspaceSearchStore((s) => s.openMatch)
  const isSearching = useWorkspaceSearchStore((s) => s.isSearching)
  const lastError = useWorkspaceSearchStore((s) => s.lastError)
  const stats = useWorkspaceSearchStore((s) => s.stats)
  const focusTokens = useWorkspaceSearchStore((s) => s.focusTokens)
  const selectedMatches = useWorkspaceSearchStore((s) => s.selectedMatches)
  const resultFiles = useWorkspaceSearchStore((state) =>
    state.fileOrder
      .map((fileKey): SearchResultFileView | null => {
        const entry = state.resultsByFile[fileKey]
        if (!entry) return null
        const matches = entry.matchIds
          .map((matchId) => state.matchesById[matchId])
          .filter((match): match is LocalSearchMatch => Boolean(match))
        return {
          key: fileKey,
          path: entry.path,
          relativePath: entry.relativePath,
          matches,
          expanded: !!state.expandedFiles[fileKey],
        }
      })
      .filter((file): file is SearchResultFileView => Boolean(file))
  )

  const queryInputRef = useRef<HTMLInputElement | null>(null)
  const replaceInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (focusTokens.query > 0) {
      queryInputRef.current?.focus()
      queryInputRef.current?.select()
    }
  }, [focusTokens.query])

  useEffect(() => {
    if (focusTokens.replace > 0) {
      replaceInputRef.current?.focus()
      replaceInputRef.current?.select()
    }
  }, [focusTokens.replace])

  const selectedCount = useMemo(() => Object.values(selectedMatches).filter(Boolean).length, [selectedMatches])
  const totalMatches = useMemo(
    () => resultFiles.reduce((total, file) => total + file.matches.length, 0),
    [resultFiles]
  )

  const handleSubmitSearch = useCallback(() => {
    void runSearch()
  }, [runSearch])

  const handleQueryKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        handleSubmitSearch()
      }
    },
    [handleSubmitSearch]
  )

  return (
    <div className="workspace-search-pane">
      <div className="workspace-search-header">
        <Group gap={6} justify="space-between" align="center">
          <Group gap={6} align="center">
            <IconSearch size={14} color="#9d9d9d" />
            <Text size="sm" fw={600} c="#f0f0f0">
              Search
            </Text>
            {stats && (
              <Badge size="xs" variant="filled" color="blue">
                {stats.matchCount} results
              </Badge>
            )}
          </Group>
          <Group gap={8} align="center">
            {isSearching && <Loader size="xs" color="blue" />}
            {stats?.limitHit && !isSearching && (
              <Text size="xs" c="yellow">
                Result limit hit
              </Text>
            )}

          </Group>
        </Group>
      </div>
      <div className="workspace-search-body">
            <div className="workspace-search-inputs">
              <TextInput
                ref={queryInputRef}
                label="Find"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={handleQueryKeyDown}
                size="xs"
                autoComplete="off"
              />
              <TextInput
                ref={replaceInputRef}
                label="Replace"
                value={replaceValue}
                onChange={(event) => setReplaceValue(event.currentTarget.value)}
                size="xs"
                autoComplete="off"
              />
            </div>
            <Group gap="xs">
              <Button size="xs" onClick={handleSubmitSearch} disabled={!query.trim()} loading={isSearching}>
                Search
              </Button>
              {isSearching && (
                <Button size="xs" variant="outline" onClick={() => void cancelSearch()}>
                  Cancel
                </Button>
              )}
              <Button
                size="xs"
                variant="outline"
                onClick={() => void applySelectedReplacements()}
                disabled={!selectedCount || isSearching}
                leftSection={<IconReplace size={14} />}
              >
                Replace Selected
              </Button>
            </Group>
            <div className="workspace-search-options">
              <Checkbox
                size="xs"
                label="Match case"
                checked={matchCase}
                onChange={(event) => setMatchCase(event.currentTarget.checked)}
              />
              <Checkbox
                size="xs"
                label="Whole word"
                checked={matchWholeWord}
                onChange={(event) => setMatchWholeWord(event.currentTarget.checked)}
              />
              <Checkbox
                size="xs"
                label="Use regex"
                checked={useRegex}
                onChange={(event) => setUseRegex(event.currentTarget.checked)}
              />
            </div>
            <div className="workspace-search-globs">
              <TextInput
                size="xs"
                label="Include"
                placeholder="e.g. src/**/*.ts"
                value={includeGlobsText}
                onChange={(event) => setIncludeGlobsText(event.currentTarget.value)}
              />
              <TextInput
                size="xs"
                label="Exclude"
                placeholder="e.g. node_modules"
                value={excludeGlobsText}
                onChange={(event) => setExcludeGlobsText(event.currentTarget.value)}
              />
            </div>
            <div className="workspace-search-options">
              <Checkbox
                size="xs"
                label="Respect .gitignore"
                checked={useIgnoreFiles}
                onChange={(event) => setUseIgnoreFiles(event.currentTarget.checked)}
              />
              <Checkbox
                size="xs"
                label="Respect global ignore"
                checked={useGlobalIgnore}
                onChange={(event) => setUseGlobalIgnore(event.currentTarget.checked)}
              />
            </div>
            {lastError && (
              <Alert color="red" variant="light" radius="sm">
                {lastError}
              </Alert>
            )}
            <Divider my={4} opacity={0.5} />
            <Group gap="sm" align="center" justify="space-between">
              <Group gap="xs" align="center">
                <Button size="xs" variant="subtle" onClick={() => selectAllMatches(true)}>
                  Select all
                </Button>
                <Button size="xs" variant="subtle" onClick={() => selectAllMatches(false)}>
                  Clear
                </Button>
                <Text size="xs" c="dimmed">
                  {selectedCount} selected
                </Text>
              </Group>
              {totalMatches > 0 && (
                <Text size="xs" c="dimmed">
                  {totalMatches} match{totalMatches === 1 ? '' : 'es'} in {resultFiles.length} file{resultFiles.length === 1 ? '' : 's'}
                </Text>
              )}
            </Group>
            <div className="workspace-search-results">
              {resultFiles.length === 0 ? (
                <div className="workspace-search-empty">
                  <Text size="sm" c="dimmed">
                    {isSearching ? 'Searching workspace…' : 'Run a search to see matches here.'}
                  </Text>
                </div>
              ) : (
                <ScrollArea style={{ flex: 1 }}>
                  <Stack gap={6} mt={4} pr={4}>
                    {resultFiles.map((file) => {
                      const selectedInFile = file.matches.filter((match) => selectedMatches[match.id]).length
                      const indeterminate = selectedInFile > 0 && selectedInFile < file.matches.length
                      return (
                        <div key={file.key} className="workspace-search-file">
                          <div className="workspace-search-file-row">
                            <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => toggleFileExpanded(file.key)}>
                              <IconChevronDown
                                size={14}
                                style={{ transform: file.expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 120ms ease' }}
                              />
                            </ActionIcon>
                            <Checkbox
                              size="xs"
                              checked={selectedInFile === file.matches.length}
                              indeterminate={indeterminate}
                              onChange={(event) => toggleFileSelection(file.key, event.currentTarget.checked)}
                            />
                            <Tooltip label={file.path} withArrow position="top-start">
                              <Text size="sm" className="workspace-search-file-label">
                                {file.relativePath || file.path}
                              </Text>
                            </Tooltip>
                            <Badge size="xs" variant="outline" color="gray">
                              {file.matches.length}
                            </Badge>
                            <ActionIcon
                              size="sm"
                              variant="light"
                              color="blue"
                              onClick={() => void replaceInFile(file.key)}
                              title="Replace matches in file"
                            >
                              <IconReplace size={14} />
                            </ActionIcon>
                          </div>
                          {file.expanded && (
                            <div className="workspace-search-match-list">
                              {file.matches.map((match) => {
                                const selected = !!selectedMatches[match.id]
                                return (
                                  <div key={match.id} className="workspace-search-match-row" data-selected={selected}>
                                    <Checkbox
                                      size="xs"
                                      checked={selected}
                                      onChange={(event) => toggleMatchSelection(match.id, event.currentTarget.checked)}
                                    />
                                    <button
                                      type="button"
                                      className="workspace-search-match-button"
                                      onClick={() => void openMatch(match.id)}
                                    >
                                      <Text size="xs" c="dimmed" style={{ width: 60 }}>
                                        {match.line}:{match.column}
                                      </Text>
                                      <span className="workspace-search-snippet">
                                        {renderMatchSnippet(match)}
                                      </span>
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </Stack>
                </ScrollArea>
              )}
            </div>
      </div>
    </div>
  )
}
