import { create } from 'zustand'

import type { GitFileDiff } from '../../shared/git'
import type { GitRepoInfo } from '../../shared/gitRepos'
import type { GitLogCommit } from '../../shared/gitLog'
import type { GitCommitDetails } from '../../shared/gitCommit'

import type { DiffAnnotation } from '../../shared/sourceControlAnnotations'

import { getBackendClient } from '@/lib/backend/bootstrap'
import { useBackendBinding } from '@/store/binding'
import { GIT_NOTIFICATION_STATUS } from '../../shared/git'
import type { GitStatusSnapshot } from '../../shared/git'

import { loadSourceControlAnnotations, saveSourceControlAnnotations } from './utils/sourceControlAnnotationsPersistence'

import type { SourceControlSelection } from './sourceControl/diffView'
import { buildHunkAnchor, buildLineAnchor, createAnnotation } from './sourceControl/diffView'
import { buildSourceControlViewModel, type SourceControlViewModel } from './sourceControl/viewModel'
import { buildSourceControlLlmContext, type SourceControlLlmContextMode } from './sourceControl/llmContext'
import { buildCommitGraphRows } from './sourceControl/commitGraph'

import { useUiStore } from './ui'

export type SourceControlRepo = GitRepoInfo

export type SourceControlChangedFile = {
  path: string
  statusLabel?: string
  staged?: boolean
}

export type SourceControlState = {
  repos: SourceControlRepo[]
  activeRepoRoot: string | null

  // v1: we can feed this from git.getStatus later; for now we support setting it from dev tooling.
  changedFiles: SourceControlChangedFile[]

  activeFilePath: string | null
  diffsByPath: Record<string, GitFileDiff | undefined>

  annotations: DiffAnnotation[]
  selection: SourceControlSelection
  editingAnnotationId: string | null
  editorDraft: string

  llmContextMode: SourceControlLlmContextMode

  commitMessageDraft: string
  commitBusy: boolean
  commitError: string | null

  activeTab: 'changes' | 'history'

  history: {
    commits: GitLogCommit[]
    cursor: string | null
    busy: boolean
    error: string | null
    selectedSha: string | null
  }

  commitDetails: GitCommitDetails | null
  commitDetailsBusy: boolean
  commitDetailsError: string | null

  selectedCommitFile: string | null
  commitDiffsByPath: Record<string, GitFileDiff | undefined>

  ui: {
    statusText: string
  }
  actions: {
    refreshRepos: () => Promise<void>
    initRepoInWorkspace: () => Promise<void>
    refreshStatus: () => Promise<void>
    refreshReposAndStatus: () => Promise<void>
    resetForWorkspace: (workspaceRoot: string | null) => void
    applyGitStatusSnapshot: (snapshot: GitStatusSnapshot) => void
    setRepos: (repos: SourceControlRepo[]) => void
    setActiveRepoRoot: (root: string | null) => void
    setStatusText: (text: string) => void

    hydrateForRepo: (repoRoot: string) => void
    setChangedFiles: (files: SourceControlChangedFile[]) => void

    selectFile: (path: string) => Promise<void>

    stageFile: (path: string) => Promise<void>
    unstageFile: (path: string) => Promise<void>

    setCommitMessageDraft: (value: string) => void
    commitStaged: () => Promise<void>

    selectHunk: (args: { filePath: string; hunkIndex: number }) => void
    selectLine: (args: { filePath: string; hunkIndex: number; side: 'left' | 'right'; lineOffsetInHunk: number }) => void

    createHunkAnnotation: (args: { filePath: string; hunkIndex: number }) => void
    createLineAnnotation: (args: {
      filePath: string
      hunkIndex: number
      side: 'left' | 'right'
      lineOffsetInHunk: number
    }) => void

    startEditAnnotation: (id: string) => void
    setEditorDraft: (value: string) => void
    saveEditorDraftToAnnotation: () => void
    deleteAnnotation: (id: string) => void
    cancelEditing: () => void

    setLlmContextMode: (mode: SourceControlLlmContextMode) => void
    attachDiffContextToNextPrompt: () => { ok: boolean; truncated: boolean; bytes: number }

    setActiveTab: (tab: 'changes' | 'history') => void

    refreshLog: () => Promise<void>
    loadMoreLog: () => Promise<void>
    selectCommit: (sha: string) => void
    fetchCommitDetails: (sha: string) => Promise<void>

    selectCommitFile: (sha: string, path: string) => Promise<void>
  }
}

export type SourceControlHistoryViewModel = {
  graphRows: ReturnType<typeof buildCommitGraphRows>
}

export const useSourceControlStore = create<SourceControlState>()((set, get) => ({
  repos: [],
  activeRepoRoot: null,

  changedFiles: [],

  activeFilePath: null,
  diffsByPath: {},

  annotations: [],
  selection: null,
  editingAnnotationId: null,
  editorDraft: '',

  llmContextMode: 'annotated',

  commitMessageDraft: '',
  commitBusy: false,
  commitError: null,

  activeTab: 'changes',

  history: {
    commits: [],
    cursor: null,
    busy: false,
    error: null,
    selectedSha: null,
  },

  commitDetails: null,
  commitDetailsBusy: false,
  commitDetailsError: null,

  selectedCommitFile: null,
  commitDiffsByPath: {},

  ui: {
    statusText: 'Git integration coming soon',
  },

  actions: {
    resetForWorkspace: (_workspaceRoot) => {
      set({
        repos: [],
        activeRepoRoot: null,
        changedFiles: [],
        activeFilePath: null,
        diffsByPath: {},
        selection: null,
        editingAnnotationId: null,
        editorDraft: '',
        history: { commits: [], cursor: null, busy: false, error: null, selectedSha: null },
        commitDetails: null,
        commitDetailsBusy: false,
        commitDetailsError: null,
        selectedCommitFile: null,
        commitDiffsByPath: {},
      })
    },

    refreshRepos: async () => {
      const client = getBackendClient()
      if (!client) return
      try {
        const res: any = await client.rpc('git.discoverRepos', {})
        if (!res?.ok) {
          console.warn('[sourceControl] Failed to discover repos', res?.error)
          set({ repos: [], activeRepoRoot: null })
          return
        }
        const repos = (Array.isArray(res.repos) ? res.repos : []) as SourceControlRepo[]
        set({ repos })

        const current = get().activeRepoRoot
        const stillValid = current && repos.some((r) => r.repoRoot === current)
        const next = stillValid ? current : (repos[0]?.repoRoot ?? null)
        set({ activeRepoRoot: next })
        if (next) get().actions.hydrateForRepo(next)
      } catch (e) {
        console.warn('[sourceControl] Failed to discover repos', e)
      }
    },

    initRepoInWorkspace: async () => {
      const client = getBackendClient()
      if (!client) return

      const workspaceRoot = useBackendBinding.getState().root
      if (!workspaceRoot) return

      try {
        const res: any = await client.rpc('git.initRepo', { repoRoot: workspaceRoot })
        if (!res?.ok) {
          console.warn('[sourceControl] Failed to init repo', res?.error)
          return
        }

        await get().actions.refreshReposAndStatus()
      } catch (e) {
        console.warn('[sourceControl] Failed to init repo', e)
      }
    },

    refreshStatus: async () => {
      const client = getBackendClient()
      const repoRoot = get().activeRepoRoot
      if (!client || !repoRoot) return

      try {
        const res: any = await client.rpc('git.getStatus', { repoRoot })
        if (!res?.ok || !res.snapshot) return
        get().actions.applyGitStatusSnapshot(res.snapshot as GitStatusSnapshot)
      } catch (e) {
        console.warn('[sourceControl] Failed to refresh git status', e)
      }
    },

    refreshReposAndStatus: async () => {
      await get().actions.refreshRepos()
      await get().actions.refreshStatus()
    },

    applyGitStatusSnapshot: (snapshot) => {
      const entries = Array.isArray((snapshot as any)?.entries) ? (snapshot as any).entries : []
      const changedFiles: SourceControlChangedFile[] = entries.map((e: any) => ({
        path: e.path,
        statusLabel: e?.status ?? undefined,
        staged: !!e?.staged,
      }))

      set({ changedFiles })

      const active = get().activeFilePath
      if (active && !changedFiles.some((f) => f.path === active)) {
        set((s) => {
          const nextDiffs = { ...s.diffsByPath }
          delete nextDiffs[active]
          return { activeFilePath: null, selection: null, diffsByPath: nextDiffs }
        })
      }
    },

    setLlmContextMode: (mode) => set({ llmContextMode: mode }),

    setActiveTab: (tab) => {
      set({ activeTab: tab })
      if (tab === 'history') {
        void get().actions.refreshLog()
      }
    },

    refreshLog: async () => {
      const client = getBackendClient()
      const repoRoot = get().activeRepoRoot
      if (!client || !repoRoot) return

      set((s) => ({ history: { ...s.history, busy: true, error: null } }))
      try {
        const res: any = await client.rpc('git.getLog', { repoRoot, limit: 50, cursor: null })
        if (!res?.ok || !res.page) {
          set((s) => ({ history: { ...s.history, busy: false, error: res?.error ?? 'failed-to-load-log' } }))
          return
        }

        const page = res.page as { commits?: GitLogCommit[]; nextCursor?: string | null }
        set((s) => ({
          history: {
            ...s.history,
            commits: Array.isArray(page.commits) ? page.commits : [],
            cursor: page.nextCursor ?? null,
            busy: false,
            error: null,
          },
        }))
      } catch (e: any) {
        set((s) => ({ history: { ...s.history, busy: false, error: e?.message || String(e) } }))
      }
    },

    loadMoreLog: async () => {
      const client = getBackendClient()
      const repoRoot = get().activeRepoRoot
      const cursor = get().history.cursor
      if (!client || !repoRoot || !cursor) return

      set((s) => ({ history: { ...s.history, busy: true, error: null } }))
      try {
        const res: any = await client.rpc('git.getLog', { repoRoot, limit: 50, cursor })
        if (!res?.ok || !res.page) {
          set((s) => ({ history: { ...s.history, busy: false, error: res?.error ?? 'failed-to-load-log' } }))
          return
        }
        const page = res.page as { commits?: GitLogCommit[]; nextCursor?: string | null }
        const nextCommits = Array.isArray(page.commits) ? page.commits : []
        set((s) => ({
          history: {
            ...s.history,
            commits: [...s.history.commits, ...nextCommits],
            cursor: page.nextCursor ?? null,
            busy: false,
            error: null,
          },
        }))
      } catch (e: any) {
        set((s) => ({ history: { ...s.history, busy: false, error: e?.message || String(e) } }))
      }
    },

    selectCommit: (sha) => {
      set((s) => ({ 
        history: { ...s.history, selectedSha: sha },
        selectedCommitFile: null,
        commitDiffsByPath: {}
      }))
      void get().actions.fetchCommitDetails(sha)
    },

    fetchCommitDetails: async (sha) => {
      const repoRoot = get().activeRepoRoot
      if (!repoRoot) return

      set({ commitDetailsBusy: true, commitDetailsError: null })
      try {
        const client = getBackendClient()
        if (!client) return

        const res: any = await client.rpc('git.getCommitDetails', { repoRoot, sha })
        if (!res?.ok) throw new Error(res?.error || 'git.getCommitDetails failed')
        
        const details = res.details as GitCommitDetails
        set({ commitDetails: details, commitDetailsBusy: false })

        // Auto-select first file if available
        if (details.files.length > 0) {
          void get().actions.selectCommitFile(sha, details.files[0]!)
        }
      } catch (e: any) {
        set({ commitDetailsBusy: false, commitDetailsError: e?.message || String(e) })
      }
    },

    selectCommitFile: async (sha, path) => {
      set({ selectedCommitFile: path })
      
      const existing = get().commitDiffsByPath[path]
      if (existing) return

      const repoRoot = get().activeRepoRoot
      if (!repoRoot) return

      try {
        const client = getBackendClient()
        if (!client) return

        const res: any = await client.rpc('git.getCommitDiff', { repoRoot, sha, path })
        if (res?.ok && res.diff) {
          set((s) => ({ commitDiffsByPath: { ...s.commitDiffsByPath, [path]: res.diff as GitFileDiff } }))
        }
      } catch (e) {
        console.warn('[sourceControl] Failed to load commit diff', e)
      }
    },

    setRepos: (repos) => {
      set({ repos })
      const current = get().activeRepoRoot
      if (!current && repos.length > 0) {
        set({ activeRepoRoot: repos[0]!.repoRoot })
        get().actions.hydrateForRepo(repos[0]!.repoRoot)
      }
    },

    setActiveRepoRoot: (root) => {
      set({ activeRepoRoot: root })
      if (root) get().actions.hydrateForRepo(root)
    },

    setStatusText: (text) => set((s) => ({ ui: { ...s.ui, statusText: text } })),

    hydrateForRepo: (repoRoot) => {
      const loaded = loadSourceControlAnnotations(repoRoot)
      set({ annotations: loaded.annotations })
    },

    setChangedFiles: (files) => set({ changedFiles: files }),

    selectFile: async (path) => {
      const repoRoot = get().activeRepoRoot
      if (!repoRoot) return
      if (!path) return

      set({ activeFilePath: path, selection: null })

      const existing = get().diffsByPath[path]
      if (existing) return

      const client = getBackendClient()
      if (!client) return

      try {
        const res: any = await client.rpc('git.getDiff', { repoRoot, path, staged: false })
        if (res?.ok && res.diff) {
          set((s) => ({ diffsByPath: { ...s.diffsByPath, [path]: res.diff as GitFileDiff } }))
        }
      } catch (e) {
        console.warn('[sourceControl] Failed to load diff', e)
      }
    },

    stageFile: async (path) => {
      const client = getBackendClient()
      const repoRoot = get().activeRepoRoot
      if (!client || !repoRoot) return
      if (!path) return

      try {
        const res: any = await client.rpc('git.stageFile', { repoRoot, path })
        if (!res?.ok) {
          console.warn('[sourceControl] Failed to stage file', res?.error)
          return
        }
        await get().actions.refreshStatus()
      } catch (e) {
        console.warn('[sourceControl] Failed to stage file', e)
      }
    },

    unstageFile: async (path) => {
      const client = getBackendClient()
      const repoRoot = get().activeRepoRoot
      if (!client || !repoRoot) return
      if (!path) return

      try {
        const res: any = await client.rpc('git.unstageFile', { repoRoot, path })
        if (!res?.ok) {
          console.warn('[sourceControl] Failed to unstage file', res?.error)
          return
        }
        await get().actions.refreshStatus()
      } catch (e) {
        console.warn('[sourceControl] Failed to unstage file', e)
      }
    },

    setCommitMessageDraft: (value) => set({ commitMessageDraft: value }),

    commitStaged: async () => {
      const client = getBackendClient()
      const repoRoot = get().activeRepoRoot
      if (!client || !repoRoot) return

      const message = get().commitMessageDraft
      if (!message?.trim()) return

      set({ commitBusy: true, commitError: null })
      try {
        const res: any = await client.rpc('git.commit', { repoRoot, message })
        if (!res?.ok) {
          set({ commitError: res?.error ?? 'commit-failed' })
          return
        }
        set({ commitMessageDraft: '' })
        await get().actions.refreshStatus()
      } catch (e: any) {
        set({ commitError: e?.message ?? String(e) })
      } finally {
        set({ commitBusy: false })
      }
    },

    selectHunk: ({ filePath, hunkIndex }) => set({ selection: { kind: 'hunk', filePath, hunkIndex } }),

    selectLine: ({ filePath, hunkIndex, side, lineOffsetInHunk }) =>
      set({ selection: { kind: 'line', filePath, hunkIndex, side, lineOffsetInHunk } }),

    createHunkAnnotation: ({ filePath, hunkIndex }) => {
      const repoRoot = get().activeRepoRoot
      if (!repoRoot) return
      const diff = get().diffsByPath[filePath]
      if (!diff) return

      const anchor = buildHunkAnchor({ repoRoot, filePath, diff, hunkIndex, diffBase: 'unstaged' })
      const ann = createAnnotation({ anchor, body: '' })

      set((s) => ({
        annotations: [ann, ...s.annotations],
        editingAnnotationId: ann.id,
        editorDraft: '',
        selection: { kind: 'hunk', filePath, hunkIndex },
      }))

      saveSourceControlAnnotations(repoRoot, { version: 1, annotations: get().annotations })
    },

    createLineAnnotation: ({ filePath, hunkIndex, side, lineOffsetInHunk }) => {
      const repoRoot = get().activeRepoRoot
      if (!repoRoot) return
      const diff = get().diffsByPath[filePath]
      if (!diff) return

      const anchor = buildLineAnchor({
        repoRoot,
        filePath,
        diff,
        hunkIndex,
        side,
        lineOffsetInHunk,
        diffBase: 'unstaged',
      })
      const ann = createAnnotation({ anchor, body: '' })

      set((s) => ({
        annotations: [ann, ...s.annotations],
        editingAnnotationId: ann.id,
        editorDraft: '',
        selection: { kind: 'line', filePath, hunkIndex, side, lineOffsetInHunk },
      }))

      saveSourceControlAnnotations(repoRoot, { version: 1, annotations: get().annotations })
    },

    startEditAnnotation: (id) => {
      const ann = get().annotations.find((a) => a.id === id)
      if (!ann) return
      set({ editingAnnotationId: id, editorDraft: ann.body })
    },

    setEditorDraft: (value) => set({ editorDraft: value }),

    saveEditorDraftToAnnotation: () => {
      const repoRoot = get().activeRepoRoot
      const id = get().editingAnnotationId
      if (!repoRoot || !id) return

      const draft = get().editorDraft
      set((s) => ({
        annotations: s.annotations.map((a) => (a.id === id ? { ...a, body: draft, updatedAt: Date.now() } : a)),
      }))
      saveSourceControlAnnotations(repoRoot, { version: 1, annotations: get().annotations })
    },

    deleteAnnotation: (id) => {
      const repoRoot = get().activeRepoRoot
      if (!repoRoot) return

      set((s) => ({
        annotations: s.annotations.filter((a) => a.id !== id),
        editingAnnotationId: s.editingAnnotationId === id ? null : s.editingAnnotationId,
        editorDraft: s.editingAnnotationId === id ? '' : s.editorDraft,
      }))

      saveSourceControlAnnotations(repoRoot, { version: 1, annotations: get().annotations })
    },

    cancelEditing: () => set({ editingAnnotationId: null, editorDraft: '' }),

    attachDiffContextToNextPrompt: () => {
      const repoRoot = get().activeRepoRoot
      if (!repoRoot) return { ok: false, truncated: false, bytes: 0 }

      const annotationsByPath: Record<string, DiffAnnotation[]> = {}
      for (const a of get().annotations) {
        const p = a.anchor.filePath
        if (!annotationsByPath[p]) annotationsByPath[p] = []
        annotationsByPath[p]!.push(a)
      }

      const { context, truncated, bytes } = buildSourceControlLlmContext({
        repoRoot,
        mode: get().llmContextMode,
        selectedFilePath: get().activeFilePath,
        diffsByPath: (get().diffsByPath as Record<string, any>) || {},
        annotationsByPath,
        maxBytes: 24_000,
      })

      useUiStore.getState().setSessionInputContext(context)
      return { ok: true, truncated, bytes }
    },
  },
}))

export function selectSourceControlHeader(state: SourceControlState): {
  title: string
  subtitle: string
  repoLabel?: string
  repos: SourceControlRepo[]
  activeRepoRoot: string | null
} {
  const repoCount = state.repos.length
  const title = 'Source Control'
  const subtitle =
    repoCount === 0
      ? state.ui.statusText
      : `${repoCount} ${repoCount === 1 ? 'repository' : 'repositories'} detected`

  const activeRepo = state.activeRepoRoot
  const repoLabel = activeRepo ? (state.repos.find((r) => r.repoRoot === activeRepo)?.name ?? activeRepo) : undefined
  return { title, subtitle, repoLabel, repos: state.repos, activeRepoRoot: state.activeRepoRoot }
}

export function selectSourceControlViewModel(state: SourceControlState): SourceControlViewModel {
  return buildSourceControlViewModel({
    changedFiles: state.changedFiles,
    activePath: state.activeFilePath,
    diffsByPath: state.diffsByPath,
    annotations: state.annotations,
  })
}

export function selectSourceControlHistoryViewModel(state: SourceControlState): SourceControlHistoryViewModel {
  return {
    graphRows: buildCommitGraphRows(state.history.commits),
  }
}

let sourceControlEventsBound = false
export function initSourceControlEvents(): void {
  if (sourceControlEventsBound) return
  const client = getBackendClient()
  if (!client) return
  sourceControlEventsBound = true

  client.subscribe(GIT_NOTIFICATION_STATUS, (snapshot: GitStatusSnapshot) => {
    try {
      useSourceControlStore.getState().actions.applyGitStatusSnapshot(snapshot)
    } catch (error) {
      console.warn('[source-control] Failed to apply git snapshot', error)
    }
  })

  client.subscribe('workspace.attached', () => {
    const root = useBackendBinding.getState().root
    try {
      useSourceControlStore.getState().actions.resetForWorkspace(root)
    } catch (error) {
      console.warn('[source-control] Failed to reset store for workspace', error)
    }
    void useSourceControlStore.getState().actions.refreshReposAndStatus()
  })

  // Refresh when user navigates to Source Control view.
  // Store-level subscription keeps components pure.
  let lastView = useUiStore.getState().currentView
  useUiStore.subscribe((s) => {
    const nextView = s.currentView
    if (nextView === 'sourceControl' && lastView !== 'sourceControl') {
      void useSourceControlStore.getState().actions.refreshReposAndStatus()
    }
    lastView = nextView
  })
}
