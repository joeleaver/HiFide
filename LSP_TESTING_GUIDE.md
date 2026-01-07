# Language Server Testing Guide

## Quick Start

1. **Rebuild the application**:
   ```bash
   npm run build
   ```

2. **Start the dev server**:
   ```bash
   npm run dev
   ```

3. **Open a TypeScript/React project** with a valid `tsconfig.json`

## Test Cases

### Test 1: React Imports (Should NOT show errors)
```typescript
import React from 'react'
import { useState } from 'react'
import { Component } from './Component'

function App() {
  return <div>Hello</div>
}
```

**Expected**: No red squiggles on imports
**Previous behavior**: "Cannot find module 'react'" error

### Test 2: JSX Syntax (Should NOT show errors)
```typescript
function MyComponent() {
  return (
    <div>
      <Component prop="value" />
      <AnotherComponent />
    </div>
  )
}
```

**Expected**: No red squiggles on JSX elements
**Previous behavior**: JSX marked as invalid

### Test 3: Path Aliases (Should work with @/*)
```typescript
import { useStore } from '@/store'
import { Button } from '@/components/Button'
```

**Expected**: Imports resolve correctly
**Previous behavior**: "Cannot find module" errors

### Test 4: Invalid Imports (Should STILL show errors)
```typescript
import { nonExistent } from 'react'
import { missing } from './missing-file'
```

**Expected**: Red squiggles on invalid imports
**Verification**: LSP is working correctly

### Test 5: Type Errors (Should show errors)
```typescript
const x: string = 123  // Type error
const y: number = "hello"  // Type error
```

**Expected**: Red squiggles on type mismatches
**Verification**: Semantic validation working

### Test 6: Workspace Switching
1. Open Project A (with tsconfig.json)
2. Open a TypeScript file - should show correct diagnostics
3. Switch to Project B (different tsconfig.json)
4. Diagnostics should update for Project B
5. Switch back to Project A - diagnostics should be correct again

**Expected**: No stale diagnostics from previous workspace

## Debugging

### Check LSP Status
1. Open DevTools (F12)
2. Look for console messages starting with `[LSP:tsserver]`
3. Should see: `Initialized` message with capabilities

### Check Document Sync
1. Open a file
2. Make a change
3. Look for `[editorStore] Failed to sync LSP document` errors
4. Should see no errors

### Check Diagnostics Flow
1. Open a file with errors
2. Look for `[lsp] Failed to apply diagnostics` in console
3. Should see no errors

### Verify Monaco Configuration
In browser console:
```javascript
// Check if semantic validation is disabled
const ts = monaco.languages.typescript
console.log(ts.typescriptDefaults.getDiagnosticsOptions())
// Should show: { noSemanticValidation: true, noSyntaxValidation: false }
```

## Performance Checks

1. **Startup time**: Should be similar or faster
2. **Typing responsiveness**: Should be immediate (syntax validation only)
3. **Diagnostics latency**: Should be < 500ms after file change
4. **Memory usage**: Should be stable (no duplicate validation)

## Rollback Plan

If issues occur:
1. Revert `src/lib/editor/monacoInstance.ts` to enable semantic validation
2. Revert `electron/services/lsp/LspManager.ts` to previous config
3. Rebuild and test

## Success Criteria

✅ React imports work without errors
✅ JSX syntax recognized correctly
✅ Path aliases (@/*) resolve
✅ Invalid imports still show errors
✅ Type errors still show errors
✅ Workspace switching works correctly
✅ No console errors related to LSP
✅ Diagnostics appear within 500ms

