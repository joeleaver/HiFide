# Language Server Protocol (LSP) Architecture Fixes

## Problem Statement
The language server was showing false positives for TypeScript/JavaScript imports and JSX syntax, even though the code was valid. This was caused by:

1. **Monaco's built-in TypeScript validation** conflicting with LSP diagnostics
2. **Semantic validation enabled** in Monaco, causing duplicate/conflicting error messages
3. **Improper workspace configuration** for the language server

## Root Cause Analysis

### Issue 1: Monaco vs LSP Conflict
- Monaco Editor has its own TypeScript compiler that validates code
- The LSP (VTSLS) also validates code independently
- Both were running simultaneously, causing conflicting diagnostics
- Monaco's validation didn't understand the workspace's tsconfig.json

### Issue 2: Missing LSP Configuration
- The language server wasn't properly configured to use workspace TypeScript
- Missing settings for JSX/TSX handling
- Missing import resolution preferences

## Solutions Implemented

### 1. Disabled Monaco's Semantic Validation
**File**: `src/lib/editor/monacoInstance.ts`

Changed:
```typescript
const diagnosticOptions = { noSemanticValidation: false, noSyntaxValidation: false }
```

To:
```typescript
const diagnosticOptions = { 
  noSemanticValidation: true,  // Disable - LSP handles this
  noSyntaxValidation: false     // Keep for immediate feedback
}
```

**Rationale**: LSP provides accurate semantic validation based on the workspace's tsconfig.json. Monaco's built-in validation was causing false positives.

### 2. Enhanced LSP Configuration
**File**: `electron/services/lsp/LspManager.ts`

Added critical settings:
- `useSyntaxServer: 'never'` - Use full TypeScript compiler, not just syntax checking
- `enablePromptUseWorkspaceTsdk: true` - Automatically use workspace TypeScript
- `jsxAttributeDefaultValue: 'none'` - Proper JSX handling
- `autoImports: true` - Enable auto-import suggestions
- `paths: true` - Support path aliases (@/*)

## Architecture Overview

```
Editor (Monaco)
    ↓
LSP Client (src/lib/lsp/client.ts)
    ↓
Backend RPC (electron/backend/ws/handlers/language-handlers.ts)
    ↓
Language Server Service (electron/services/LanguageServerService.ts)
    ↓
LSP Manager (electron/services/lsp/LspManager.ts)
    ↓
VTSLS Process (TypeScript Language Server)
    ↓
Workspace tsconfig.json
```

## Document Synchronization Flow

1. User opens file → `openFile()` in editor store
2. Editor calls `openLspDocument()` → sends to backend
3. Backend calls `languageService.openDocument()`
4. LSP Manager sends `didOpen` notification to VTSLS
5. VTSLS reads workspace tsconfig.json and validates
6. Diagnostics flow back through the same path
7. Monaco displays LSP diagnostics (not its own)

## Workspace Switching

When user switches workspaces:
1. `workspace.attached` event fires
2. `resetLspWorkspace()` called
3. Old LSP manager disposed
4. New LSP manager created for new workspace
5. New workspace's tsconfig.json is used

## Testing the Fix

1. Open a TypeScript/React project with tsconfig.json
2. Import React: `import React from 'react'` - should NOT show error
3. Use JSX: `<Component />` - should NOT show error
4. Invalid imports should still show errors
5. Switch to different workspace - diagnostics should update

## Files Modified

1. `src/lib/editor/monacoInstance.ts` - Disabled semantic validation
2. `electron/services/lsp/LspManager.ts` - Enhanced LSP configuration

## Files NOT Modified (Working Correctly)

- `src/lib/lsp/client.ts` - Document sync working correctly
- `src/lib/lsp/diagnostics.ts` - Diagnostic handling working correctly
- `src/lib/lsp/providers.ts` - Completion/hover/definition working correctly
- `src/store/lspDiagnostics.ts` - Diagnostic state management working correctly
- `src/store/explorer/base.ts` - Diagnostic aggregation working correctly
- `electron/services/LanguageServerService.ts` - Service management working correctly
- `electron/services/lsp/LspClient.ts` - LSP communication working correctly

## Performance Impact

- **Positive**: Reduced duplicate validation (Monaco + LSP)
- **Positive**: Faster diagnostics (only LSP, not Monaco)
- **Neutral**: No additional network overhead

## Future Improvements

1. Add LSP semantic tokens for syntax highlighting
2. Add LSP code lens support
3. Add LSP inlay hints
4. Cache workspace tsconfig.json parsing

