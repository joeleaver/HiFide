# LSP Client Disposed Error - Fix

## Problem

When switching workspaces or opening files in a different workspace, the following error occurred:

```
Unhandled rejection {
  name: 'Error',
  message: 'LspClient disposed',
  ...
}
```

This happened because:
1. The `didOpen`, `didChange`, and `didClose` methods in `LspManager` were calling `sendNotification()` without awaiting
2. When a workspace was switched, the LSP client could be disposed before the notification was sent
3. The pending notification would then fail with "LspClient disposed" error

## Root Cause

In `electron/services/lsp/LspManager.ts`, three methods were not properly handling async operations:

```typescript
// BEFORE (incorrect)
async didOpen(params) {
  const client = await this.getClientForLanguage(lang)
  if (!client) return
  
  client.sendNotification(...)  // ❌ Not awaited!
}
```

The `sendNotification()` method is async and calls `ensureReady()`, which throws "LspClient disposed" if the client has been disposed. Without awaiting, the error happens asynchronously and is not caught.

## Solution

Added proper error handling and awaiting to all three methods:

```typescript
// AFTER (correct)
async didOpen(params) {
  const client = await this.getClientForLanguage(lang)
  if (!client) return
  
  try {
    await client.sendNotification(...)  // ✅ Now awaited
  } catch (error: any) {
    // Silently ignore if client was disposed (e.g., workspace switched)
    if (error?.message?.includes('disposed')) {
      console.debug(`[LSP] Client disposed while opening ${params.path}`)
      return
    }
    console.error(`[LSP] Failed to open document ${params.path}:`, error)
  }
}
```

## Changes Made

### File: `electron/services/lsp/LspManager.ts`

**Method 1: `didOpen` (lines 166-189)**
- Added `await` to `client.sendNotification()`
- Added try-catch block
- Silently ignore "disposed" errors (expected when workspace switches)
- Log other errors for debugging

**Method 2: `didChange` (lines 191-208)**
- Added `await` to `client.sendNotification()`
- Added try-catch block
- Same error handling as `didOpen`

**Method 3: `didClose` (lines 210-226)**
- Added `await` to `client.sendNotification()`
- Added try-catch block
- Same error handling as `didOpen`

## Why This Works

1. **Awaiting the notification**: Ensures the operation completes before the method returns
2. **Try-catch block**: Catches any errors that occur during the notification
3. **Disposed error handling**: Silently ignores "disposed" errors since they're expected when:
   - Workspace is switched
   - Window is closed
   - LSP client is being cleaned up
4. **Other error logging**: Logs unexpected errors for debugging

## Testing

To verify the fix:

1. **Build the application**:
   ```bash
   npm run build
   ```

2. **Start the dev server**:
   ```bash
   npm run dev
   ```

3. **Test workspace switching**:
   - Open a TypeScript file in workspace A
   - Switch to workspace B
   - Open a TypeScript file in workspace B
   - **Expected**: No "LspClient disposed" errors in console

4. **Test file opening**:
   - Open multiple TypeScript files quickly
   - Switch between them rapidly
   - **Expected**: No unhandled rejection errors

## Impact

- ✅ Fixes "LspClient disposed" unhandled rejection errors
- ✅ Gracefully handles workspace switches
- ✅ Maintains LSP functionality
- ✅ No breaking changes
- ✅ Backward compatible

## Related Files

- `electron/services/lsp/LspClient.ts` - LSP client implementation
- `electron/services/lsp/LspManager.ts` - LSP manager (fixed)
- `electron/services/LanguageServerService.ts` - Language server service facade
- `src/lib/lsp/client.ts` - Frontend LSP client

## Future Improvements

1. Add metrics to track how often "disposed" errors occur
2. Add retry logic for transient failures
3. Implement LSP client reconnection on disposal
4. Add telemetry for LSP lifecycle events

