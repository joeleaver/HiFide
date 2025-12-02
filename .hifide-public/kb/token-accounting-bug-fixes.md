---
id: d9eec60e-9428-424e-845e-172cc88b16d7
title: Token Accounting Bug Fixes
tags: [bug-fix, token-accounting, logging, ui]
files: [src/renderer-logger.ts, electron/logger.ts, electron/flow-engine/scheduler.ts]
createdAt: 2025-12-01T23:54:41.864Z
updatedAt: 2025-12-01T23:54:41.864Z
---

## Token Accounting Bug Fixes

### Issue 1: Logger Redacting Token Counts

**Problem**: The logger was redacting all object keys containing "token", including:
- `inputTokens`
- `outputTokens`
- `totalTokens`
- `cachedTokens`

This caused the UI to receive literal `"***REDACTED***"` strings instead of actual token counts.

**Root Cause**: Overly aggressive regex in `src/renderer-logger.ts` and `electron/logger.ts`:
```javascript
/(?:^|_|-)(?:api|x)?-?key$|authorization|bearer|token/i.test(key)
```

**Fix**: Changed regex to only match keys named exactly "token":
```javascript
/(?:^|_|-)(?:api|x)?-?key$|authorization|bearer|^token$/i.test(key)
```

**Files Modified**:
- `src/renderer-logger.ts` (line 42)
- `electron/logger.ts` (line 42)

### Issue 2: Missing cachedTokens in Token Usage Events

**Problem**: The `usage` event handler in scheduler.ts was not passing `cachedTokens` when emitting token usage events, causing all cached token counts to be 0.

**Root Cause**: The usage object in scheduler.ts only included:
```javascript
{ inputTokens, outputTokens, totalTokens }
```

**Fix**: Added `cachedTokens` to the usage object:
```javascript
{ inputTokens, outputTokens, totalTokens, cachedTokens: event.usage.cachedTokens || 0 }
```

**File Modified**:
- `electron/flow-engine/scheduler.ts` (line 958)

### Verification

After these fixes:
✅ Token counts display as real numbers
✅ Cached tokens are properly tracked and accumulated
✅ API keys and auth tokens remain properly redacted
✅ Tokens & Costs panel shows accurate data