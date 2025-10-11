export {};

declare global {
  interface Window {
    secrets?: {
      setApiKey: (k: string) => Promise<boolean>;
      getApiKey: () => Promise<string | null>;
      setApiKeyFor: (provider: string, key: string) => Promise<boolean>;
      getApiKeyFor: (provider: string) => Promise<string | null>;
      validateApiKeyFor: (provider: string, key: string, model?: string) => Promise<{ ok: boolean; error?: string }>;
      presence: () => Promise<{ openai: boolean; anthropic: boolean; gemini: boolean }>;
      onPresenceChanged: (listener: (p: { openai: boolean; anthropic: boolean; gemini: boolean }) => void) => () => void;
    };
    models?: {
      list: (provider: string) => Promise<{ ok: boolean; models?: Array<{ id: string; label?: string; supported?: string[] }>; error?: string }>;
    };
    llm?: {
      start: (
        requestId: string,
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        model?: string,
        provider?: string,
        sessionId?: string,
      ) => Promise<{ ok: boolean }>;
      agentStart: (
        requestId: string,
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        model?: string,
        provider?: string,
        tools?: string[],
        responseSchema?: any,
        sessionId?: string,
      ) => Promise<{ ok: boolean }>;
      auto: (
        requestId: string,
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        model?: string,
        provider?: string,
        tools?: string[],
        responseSchema?: any,
        sessionId?: string,
      ) => Promise<{ ok: boolean; mode?: 'chat'|'tools'|'plan' }>;
      cancel: (requestId: string) => Promise<{ ok: boolean }>;
    };
    ipcRenderer: {
      on: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
      off: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
      send: (channel: string, ...args: any[]) => void;
      invoke: (channel: string, ...args: any[]) => Promise<any>;
    };
    fs?: {
      getCwd: () => Promise<string>;
      readFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
      readDir: (dirPath: string) => Promise<{
        success: boolean;
        entries?: Array<{ name: string; isDirectory: boolean; path: string }>;
        error?: string
      }>;
      watchDir: (dirPath: string) => Promise<{ success: boolean; id?: number; error?: string }>;
      unwatch: (id: number) => Promise<{ success: boolean; error?: string }>;
      onWatch: (listener: (payload: { id: number; type: 'rename' | 'change'; path: string; dir: string }) => void) => () => void;
    };
    sessions?: {
      list: () => Promise<{ ok: boolean; sessions?: any[]; error?: string }>;
      load: (sessionId: string) => Promise<{ ok: boolean; session?: any; error?: string }>;
      save: (session: any) => Promise<{ ok: boolean; error?: string }>;
      delete: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
    };
    pty?: {
      create: (opts?: { shell?: string; cwd?: string; cols?: number; rows?: number; env?: Record<string, string>; log?: boolean }) => Promise<{ sessionId: string }>;
      write: (sessionId: string, data: string) => Promise<{ ok: boolean }>;
      resize: (sessionId: string, cols: number, rows: number) => Promise<{ ok: boolean }>;
      dispose: (sessionId: string) => Promise<{ ok: boolean }>;
      execAgent: (sessionId: string, command: string, opts?: { confidence?: number; autoApproveEnabled?: boolean; autoApproveThreshold?: number }) => Promise<{ ok: boolean; blocked?: boolean; error?: string }>;
      onData: (listener: (payload: { sessionId: string; data: string }) => void) => () => void;
      onExit: (listener: (payload: { sessionId: string; exitCode: number }) => void) => () => void;
        attachAgent: (opts?: { requestId?: string; sessionId?: string; tailBytes?: number }) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
        detachAgent: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;

    };

      tsRefactor?: {
        rename: (filePath: string, oldName: string, newName: string, opts?: { verify?: boolean; tsconfigPath?: string }) => Promise<{ ok: boolean; verification?: { ok: boolean; exitCode: number; stdout: string; stderr: string }; error?: string }>;
        organizeImports: (opts?: { filePath?: string; verify?: boolean; tsconfigPath?: string }) => Promise<{ ok: boolean; verification?: { ok: boolean; exitCode: number; stdout: string; stderr: string }; error?: string }>;
      };
      tsRefactorEx?: {
        addExportNamed: (filePath: string, exportName: string, code?: string, opts?: { apply?: boolean; verify?: boolean; tsconfigPath?: string }) => Promise<{ ok: boolean; edits?: Array<{ type: 'modify'|'move'; path: string; newPath?: string; oldText?: string; newText?: string }>; verification?: { ok: boolean; exitCode: number; stdout: string; stderr: string }; error?: string }>;
        moveFile: (fromPath: string, toPath: string, opts?: { apply?: boolean; verify?: boolean; tsconfigPath?: string }) => Promise<{ ok: boolean; edits?: Array<{ type: 'modify'|'move'; path: string; newPath?: string; oldText?: string; newText?: string }>; verification?: { ok: boolean; exitCode: number; stdout: string; stderr: string }; error?: string }>;
      };
      tsExportUtils?: {
        ensureDefaultExport: (filePath: string, name?: string, code?: string, opts?: { apply?: boolean; verify?: boolean; tsconfigPath?: string }) => Promise<{ ok: boolean; edits?: Array<{ type: 'modify'|'move'; path: string; newPath?: string; oldText?: string; newText?: string }>; verification?: { ok: boolean; exitCode: number; stdout: string; stderr: string }; error?: string }>;
        addExportFrom: (indexFilePath: string, exportName: string, fromFilePath: string, opts?: { apply?: boolean; verify?: boolean; tsconfigPath?: string }) => Promise<{ ok: boolean; edits?: Array<{ type: 'modify'|'move'; path: string; newPath?: string; oldText?: string; newText?: string }>; verification?: { ok: boolean; exitCode: number; stdout: string; stderr: string }; error?: string }>;
      };
      tsTransform?: {
        suggestParams: (filePath: string, start: number, end: number, opts?: { tsconfigPath?: string }) => Promise<{ ok: boolean; params?: string[]; error?: string }>;
        extractFunction: (filePath: string, start: number, end: number, newName: string, opts?: { params?: string[]; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => Promise<{ ok: boolean; edits?: Array<{ type: 'modify'|'move'; path: string; newPath?: string; oldText?: string; newText?: string }>; verification?: { ok: boolean; exitCode: number; stdout: string; stderr: string }; error?: string }>;
      };
      tsInline?: {
        inlineVariable: (filePath: string, name: string, opts?: { apply?: boolean; verify?: boolean; tsconfigPath?: string }) => Promise<{ ok: boolean; edits?: Array<{ type: 'modify'|'move'; path: string; newPath?: string; oldText?: string; newText?: string }>; verification?: { ok: boolean; exitCode: number; stdout: string; stderr: string }; error?: string }>;
        inlineFunction: (filePath: string, name: string, opts?: { apply?: boolean; verify?: boolean; tsconfigPath?: string }) => Promise<{ ok: boolean; edits?: Array<{ type: 'modify'|'move'; path: string; newPath?: string; oldText?: string; newText?: string }>; verification?: { ok: boolean; exitCode: number; stdout: string; stderr: string }; error?: string }>;
        defaultToNamed: (filePath: string, newName: string, opts?: { apply?: boolean; verify?: boolean; tsconfigPath?: string }) => Promise<{ ok: boolean; edits?: Array<{ type: 'modify'|'move'; path: string; newPath?: string; oldText?: string; newText?: string }>; verification?: { ok: boolean; exitCode: number; stdout: string; stderr: string }; error?: string }>;
        namedToDefault: (filePath: string, name: string, opts?: { apply?: boolean; verify?: boolean; tsconfigPath?: string }) => Promise<{ ok: boolean; edits?: Array<{ type: 'modify'|'move'; path: string; newPath?: string; oldText?: string; newText?: string }>; verification?: { ok: boolean; exitCode: number; stdout: string; stderr: string }; error?: string }>;
      };
      edits?: {
        propose: (
          instruction: string,
          model?: string,
          provider?: string,
          k?: number
        ) => Promise<{ ok: boolean; edits?: Array<
          | { type: 'replaceOnce'; path: string; oldText: string; newText: string }
          | { type: 'insertAfterLine'; path: string; line: number; text: string }
          | { type: 'replaceRange'; path: string; start: number; end: number; text: string }
        >; error?: string; raw?: string }>;
        apply: (
          edits: Array<
            | { type: 'replaceOnce'; path: string; oldText: string; newText: string }
            | { type: 'insertAfterLine'; path: string; line: number; text: string }
            | { type: 'replaceRange'; path: string; start: number; end: number; text: string }
          >,
          opts?: { dryRun?: boolean; verify?: boolean; tsconfigPath?: string }
        ) => Promise<{
          ok: boolean;
          applied: number;
          results: Array<{ path: string; changed: boolean; message?: string }>;
          dryRun: boolean;
          verification?: { ok: boolean; exitCode: number; stdout: string; stderr: string };
          error?: string;
        }>;
      };

      indexing?: {
        rebuild: () => Promise<{ ok: boolean; status?: { ready: boolean; chunks: number; modelId?: string; dim?: number; indexPath: string; exists?: boolean; inProgress?: boolean; phase?: string; processedFiles?: number; totalFiles?: number; processedChunks?: number; totalChunks?: number; elapsedMs?: number }; error?: string }>;
        cancel: () => Promise<{ ok: boolean; error?: string }>;
        status: () => Promise<{ ok: boolean; status?: { ready: boolean; chunks: number; modelId?: string; dim?: number; indexPath: string; exists?: boolean; inProgress?: boolean; phase?: string; processedFiles?: number; totalFiles?: number; processedChunks?: number; totalChunks?: number; elapsedMs?: number }; error?: string }>;
        clear: () => Promise<{ ok: boolean; error?: string }>;
        search: (query: string, k?: number) => Promise<{ ok: boolean; chunks?: Array<{ path: string; startLine: number; endLine: number; text: string }>; error?: string }>;
      };
      workspace?: {
        getRoot: () => Promise<string>;
        setRoot: (newRoot: string) => Promise<{ ok: boolean; error?: string }>;
        openFolderDialog: () => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
        notifyRecentFoldersChanged: (recentFolders: Array<{ path: string; lastOpened: number }>) => void;
        bootstrap: (baseDir: string, preferAgent?: boolean, overwrite?: boolean) => Promise<{
          ok: boolean;
          createdPublic?: boolean;
          createdPrivate?: boolean;
          ensuredGitIgnore?: boolean;
          generatedContext?: boolean;
          error?: string;
        }>;
      };
      planning?: {
        saveApproved: (plan: any) => Promise<{ ok: boolean; error?: string }>;
        loadApproved: () => Promise<{ ok: boolean; plan?: any; error?: string }>;
      };

    }
  }




