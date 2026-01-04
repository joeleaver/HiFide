---
id: fc4b3b83-85e9-4f4c-9602-e28d9e29638b
title: Indexing Startup State Persistence and Missing Files Detection
tags: [indexing, startup, state-persistence, file-discovery, optimization, settings, architecture]
files: [electron/services/indexing/IndexOrchestrator.ts, electron/services/vector/VectorService.ts, electron/services/SettingsService.ts, electron/utils/fileDiscovery.ts, electron/services/WorkspaceService.ts]
createdAt: 2026-01-04T20:59:24.049Z
updatedAt: 2026-01-04T20:59:24.049Z
---

## Overview
The indexing start/stop state persistence and startup file detection system ensures that:
1. The indexing enabled/disabled state is persisted in settings
2. On workspace load, the system respects this state
3. File watching and indexing starts immediately if indexing is enabled
4. The system only indexes files that aren't already in the database (efficient startup)

## Architecture

### Settings Persistence
The `indexingEnabled` flag is stored in `SettingsService` at:
```
settings.vector.indexingEnabled
```
Defaults to `true` and is persisted automatically by the Service base class.

### Components

#### 1. IndexOrchestrator.runStartupCheck()
Called when a workspace is loaded. Implements the following logic:

1. Check `settings.vector.indexingEnabled`
2. If disabled: return early (no indexing)
3. If enabled:
   - Get all indexed file paths from VectorService (`getIndexedFilePaths`)
   - Discover all files in workspace using `fileDiscovery.discoverWorkspaceFiles`
   - Compare the two lists to find missing files
   - Queue missing files for indexing
   - Start the file watcher

#### 2. VectorService.getIndexedFilePaths(type)
New method that queries the LanceDB table to get all unique `filePath` values.
Uses efficient SQL-like query to avoid loading vector embeddings:
```typescript
await (table as any).query().select(['filePath']).toArray()
```

#### 3. IndexOrchestrator.discoverWorkspaceFiles(rootPath)
Private method that discovers all code files in the workspace using the same exclusion logic as the file watcher:
- Uses `fast-glob` with the same glob patterns
- Respects `.gitignore`
- Excludes `.git`, `node_modules`, `dist`, `.hifide-*` directories

### File Discovery Patterns
The system indexes the following file types:
- TypeScript: `*.ts`, `*.tsx`
- JavaScript: `*.js`, `*.jsx`
- Python: `*.py`
- Java: `*.java`
- C/C++: `*.c`, `*.cpp`, `*.h`
- C#: `*.cs`
- Go: `*.go`
- Rust: `*.rs`
- Ruby: `*.rb`
- PHP: `*.php`
- Swift: `*.swift`
- Kotlin: `*.kt`
- Scala: `*.scala`
- Dart: `*.dart`
- Lua: `*.lua`
- R: `*.r`
- Objective-C: `*.m`, `*.mm`
- Shell scripts: `*.sh`, `*.bash`, `*.zsh`, `*.fish`, `*.ps1`
- Config/data: `*.json`, `*.yaml`, `*.yml`, `*.toml`, `*.xml`
- Documentation: `*.md`, `*.txt`
- GraphQL: `*.graphql`, `*.gql`
- SQL: `*.sql`

## Flow Diagram

```
Workspace Load
     ↓
WorkspaceService.openFolder()
     ↓
VectorService.init()
     ↓
IndexOrchestrator.runStartupCheck()
     ↓
Check settings.vector.indexingEnabled
     ↓
  ├─ Disabled → Return (no indexing)
  └─ Enabled → Continue
         ↓
    Get indexed files from DB
         ↓
    Discover files in workspace
         ↓
    Compare lists (missing = discovered - indexed)
         ↓
    Queue missing files
         ↓
    Start watcher
         ↓
    Process queue
```

## Benefits

### 1. Efficient Startup
- Only indexes files that aren't already in the database
- Avoids re-processing large workspaces on every startup
- Significantly reduces startup time for existing workspaces

### 2. Persistent User Preference
- Respects the user's indexing enabled/disabled preference
- If user disabled indexing, it stays disabled across app restarts
- If user enabled indexing, it automatically starts on workspace load

### 3. Consistent Exclusion
- Uses the same file discovery logic as the runtime file watcher
- Respects `.gitignore` and default exclusion patterns
- Prevents indexing of build artifacts and dependencies

## Implementation Details

### File: `electron/services/indexing/IndexOrchestrator.ts`
```typescript
async runStartupCheck(rootPath: string = '') {
  // Check settings
  const indexingEnabled = settingsService.state.vector?.indexingEnabled ?? true;
  
  if (!indexingEnabled) return;
  
  // Get indexed files
  const indexedFiles = await vectorService.getIndexedFilePaths('code');
  
  // Discover files
  const discoveredFiles = await this.discoverWorkspaceFiles(rootPath);
  
  // Find missing
  const missingFiles = discoveredFiles.filter(filePath => !indexedFiles.has(filePath));
  
  // Queue and start
  if (missingFiles.length > 0) {
    this.queue.push(missingFiles.map(f => ({ type: 'add', path: f })));
  }
  await this.start(rootPath);
}
```

### File: `electron/services/vector/VectorService.ts`
```typescript
async getIndexedFilePaths(type: TableType = 'code'): Promise<Set<string>> {
  const table = await this.getOrCreateTable(type);
  const results = await (table as any).query().select(['filePath']).toArray();
  
  const filePaths = new Set<string>();
  for (const row of results) {
    if (row.filePath && !row.filePath.startsWith('seed-')) {
      filePaths.add(row.filePath);
    }
  }
  return filePaths;
}
```

## Testing
To verify the implementation:
1. Disable indexing in settings
2. Close and reopen app
3. Open a workspace - indexing should NOT start
4. Enable indexing
5. Open a new workspace - only missing files should be indexed
6. Restart app - should not re-index existing files