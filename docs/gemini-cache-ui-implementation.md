# Gemini Context Caching UI Implementation

## Overview

This document describes the implementation of UI features to display Gemini context caching savings throughout the HiFide application. The implementation tracks cached tokens, calculates cost savings, and displays this information in multiple locations.

## Changes Made

### 1. Type Definitions

#### `src/store/types.ts`
- **TokenUsage**: Added `cachedTokens?: number` field to track tokens served from cache
- **TokenCost**: Added three new fields:
  - `cachedInputCost?: number` - Cost of cached tokens
  - `savings?: number` - Amount saved from caching
  - `savingsPercent?: number` - Percentage saved from caching
- **ChatMessage**: Added `tokenUsage?: TokenUsage` field to attach token usage to individual messages
- **ModelPricing**: Added `cachedInputCostPer1M?: number` field for cached token pricing

#### `electron/providers/provider.ts`
- **TokenUsage**: Added `cachedTokens?: number` field (matching renderer-side type)

### 2. Pricing Configuration

#### `src/data/defaultPricing.ts`
- **ModelPricing type**: Added `cachedInputCostPer1M?: number` field
- **Gemini 2.5 models**: Added cached pricing (75% discount):
  - `gemini-2.5-pro`: `cachedInputCostPer1M: 0.3125` (from $1.25/1M)
  - `gemini-2.5-flash`: `cachedInputCostPer1M: 0.075` (from $0.30/1M)
  - `gemini-2.5-flash-lite`: `cachedInputCostPer1M: 0.025` (from $0.10/1M)

### 3. Cost Calculation

#### `src/store/slices/settings.slice.ts`
Updated `calculateCost` function to:
1. Separate cached tokens from normal input tokens
2. Calculate costs at different rates:
   - Normal input tokens at `inputCostPer1M`
   - Cached tokens at `cachedInputCostPer1M` (or fallback to normal rate)
3. Calculate savings:
   - `savings = (what we would have paid) - (what we actually paid)`
   - `savingsPercent = (savings / totalWithoutSavings) * 100`
4. Return extended TokenCost with savings information

### 4. Provider Updates

#### `electron/providers/gemini.ts`
Updated all token usage reporting locations to include `cachedTokens`:
- `chatStream` method (line ~127)
- Non-streaming chat (line ~171)
- Non-streaming fallback (line ~208)
- `agentStream` method (line ~409)

All locations now:
1. Extract `cachedContentTokenCount` from `usageMetadata`
2. Include it in the `onTokenUsage` callback
3. Log cache hits to console

### 5. Session Tracking

#### `src/store/slices/session.slice.ts`
- **recordTokenUsage**: Updated to track `cachedTokens` in both provider-specific and total usage
- **Message creation**: Updated to attach `tokenUsage` to assistant messages when they're added

### 6. UI Display

#### `src/components/AgentView.tsx`

**Last Request Section** (lines 312-347):
- Shows cached token count inline with input tokens: `💾 X cached`
- Displays savings in cost line: `(saved $X.XXXX · Y%)`

**Session Totals Section** (lines 233-278):
- Shows total cached tokens across session: `💾 X cached`
- Calculates and displays total savings across all providers/models
- Shows savings amount and percentage: `(saved $X.XXXX · Y%)`

#### `src/ChatPane.tsx`

**Message Badges** (lines 91-136):
- Added cache hit badge for assistant messages with cached tokens
- Badge shows: `💾 X cached`
- Tooltip shows full count: `X tokens served from cache`
- Badge appears alongside intent and tool call badges

## How It Works

### Data Flow

1. **Gemini Provider** detects cached tokens in `usageMetadata.cachedContentTokenCount`
2. **Provider** includes `cachedTokens` in `TokenUsage` callback
3. **Session Slice** stores usage in `lastRequestTokenUsage` and attaches to message
4. **Session Slice** accumulates cached tokens in session totals
5. **Settings Slice** calculates costs with separate rates for cached vs normal tokens
6. **UI Components** display cached tokens and savings

### Cost Calculation Example

For a request with:
- 50,000 input tokens (10,000 cached)
- 1,000 output tokens
- Model: gemini-2.5-flash

Calculation:
```
Normal input: 40,000 tokens × $0.30/1M = $0.0120
Cached input: 10,000 tokens × $0.075/1M = $0.00075
Output: 1,000 tokens × $2.50/1M = $0.0025
Total cost: $0.01525

Savings calculation:
Full price for cached: 10,000 × $0.30/1M = $0.003
Actual cached cost: $0.00075
Savings: $0.00225
Savings %: ($0.00225 / $0.01750) × 100 = 12.9%
```

## UI Examples

### Chat Message Badge
```
💾 10,000 cached
```

### Last Request Display
```
Tokens: 50,000 in (💾 10,000 cached) + 1,000 out = 51,000
Cost: $0.0153 (saved $0.0023 · 13%)
```

### Session Totals Display
```
Tokens: 150,000 in (💾 48,000 cached) + 5,000 out = 155,000
Cost: $0.0582 (saved $0.0108 · 16%)
```

## Testing

To test the implementation:

1. **Use Gemini 2.5 models** (Flash or Pro) - these support context caching
2. **Send messages with large context** (>1,024 tokens for Flash, >4,096 for Pro)
3. **Continue conversation** - subsequent messages should show cache hits
4. **Check console logs** for cache hit messages: `[Gemini] Cache hit: X tokens served from cache`
5. **Verify UI displays**:
   - Cache badge appears on assistant messages
   - Last Request shows cached tokens and savings
   - Session Totals accumulate cached tokens and savings

## Benefits

1. **Transparency**: Users can see exactly how much they're saving from caching
2. **Cost Awareness**: Real-time feedback on cost optimization
3. **Debugging**: Easy to verify that caching is working as expected
4. **Motivation**: Visible savings encourage efficient prompt design

## Future Enhancements

Potential improvements:
- Add cache statistics to session export/reports
- Show cache hit rate (% of requests with cache hits)
- Display cache efficiency (% of tokens from cache)
- Add settings to configure cache display preferences
- Support explicit caching UI (create/manage cache entries)

