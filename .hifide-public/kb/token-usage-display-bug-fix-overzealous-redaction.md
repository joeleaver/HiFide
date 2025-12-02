---
id: 47453705-e81c-4db4-bdf1-711818089f1e
title: Token Usage Display Bug Fix - Overzealous Redaction
tags: [bug-fix, logging, token-usage, security, redaction]
files: [src/renderer-logger.ts, electron/logger.ts, src/store/sessionUi.ts, src/components/TokensCostsPanel.tsx]
createdAt: 2025-12-01T23:52:23.798Z
updatedAt: 2025-12-01T23:52:23.798Z
---

## Issue
Token usage counts (`inputTokens`, `outputTokens`, `totalTokens`, `cachedTokens`) were being redacted as `"***REDACTED***"` instead of showing actual numbers in the Tokens & Costs panel.

## Root Cause
The logger's `redactObject` function had an overly broad regex pattern that matched any object key containing "token":
```javascript
if (/(?:^|_|-)(?:api|x)?-?key$|authorization|bearer|token/i.test(key))
```

This regex was designed to redact API keys and auth tokens, but it also matched token count fields like:
- `inputTokens`
- `outputTokens` 
- `totalTokens`
- `cachedTokens`

## Solution
Updated the regex to only match exact "token" keys (not substrings):
```javascript
if (/(?:^|_|-)(?:api|x)?-?key$|authorization|bearer|^token$/i.test(key))
```

The `^token$` anchor ensures only keys exactly named "token" are redacted, not keys that contain "token" as part of a larger name.

## Files Modified
- `src/renderer-logger.ts` (line 44)
- `electron/logger.ts` (line 44)

## Testing
After fix, token usage data flows correctly:
1. Events arrive: `session.usage.changed`
2. State updates: `__setUsage` called with real numbers
3. UI renders: `TokensCostsPanel` displays actual token counts