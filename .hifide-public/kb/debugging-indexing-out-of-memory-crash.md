---
id: 90000bb5-9378-4187-afa3-fbd52089e09c
title: Debugging Indexing Out of Memory Crash
tags: [debugging, memory, oom, indexing, performance, optimization]
files: [electron/services/vector/EmbeddingService.ts, electron/services/vector/VectorService.ts, electron/services/indexing/IndexOrchestrator.ts, electron/workers/indexing/v2-parser-worker.ts]
createdAt: 2026-01-04T16:57:59.937Z
updatedAt: 2026-01-04T19:45:18.099Z
---

# Debugging Indexing Out of Memory Crash

## Issue
The indexer process crashes with `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`.

## Root Causes

### 1. Unbounded Embedding Cache (PRIMARY ISSUE - 2025-12-31)
**Location:** `electron/services/vector/EmbeddingService.ts`

The `EmbeddingService` uses an unbounded `Map` to cache all embeddings indefinitely:
```typescript
private cache = new Map<string, number[]>();
```

**Memory Impact:**
- Each cached entry: `text` (up to 8KB) + `vector` (384-3072 floats = 1.5-12KB) = ~2-20KB per entry
- With 1000 files and 200 chunks each = 200,000 cached entries
- Total cache memory: 200,000 × 10KB average = **2GB+ in cache alone**

During indexing, every unique chunk is cached, but the cache is never cleared. This causes exponential memory growth.

### 2. Excessive ANN Index Creation
**Location:** `electron/services/vector/VectorService.ts:upsertItems`

The code creates an ANN index on EVERY batch upsert:
```typescript
await (table as any).createIndex('vector', {
  config: lancedb.Index.ivfPq({ numPartitions: 2, numSubVectors: 2 })
});
```

**Memory Impact:**
- Index creation is CPU and memory intensive
- Called on every batch (every 10 chunks)
- For large index builds, temporary data structures can consume hundreds of MB

### 3. Parallel Worker Memory Accumulation
**Location:** `electron/services/indexing/IndexOrchestrator.ts`

The orchestrator runs 4 workers in parallel, each processing files with up to 500 chunks:
```typescript
private maxWorkers = 4;
const MAX_CHUNKS = 500; // in parser worker
```

**Memory Impact per worker:**
- Up to 500 chunks × 8KB text = **4MB per file**
- 4 workers × 4MB = **16MB of chunk text in memory**
- Plus embedding generation and intermediate structures

### 4. Batch Embedding Without Flow Control
**Location:** `electron/services/vector/VectorService.ts:upsertItems`

Embeddings are generated for entire batches in parallel:
```typescript
const vectors = await Promise.all(items.map(async (item, idx) => {
  return await embeddingService.embed(item.text);
}));
```

**Memory Impact:**
- All embeddings for a batch (10 items) are generated and held in memory simultaneously
- With 4 parallel workers: 40 embeddings being generated at once
- Each embedding: 384-3072 floats (1.5-12KB)
- Total: 40 × 6KB average = **240KB per batch cycle** (continuous accumulation)

## Memory Math Summary

For a typical indexing session (1000 files, 200 chunks/file):

1. **Parser chunks:** 1000 files × 200 chunks × 8KB = 1.6GB (accumulated over time)
2. **Embeddings:** 200,000 chunks × 384 dims × 4 bytes = 300MB
3. **Embedding cache:** 200,000 entries × 10KB average = **2GB**
4. **ANN index temp:** 50-500MB per index creation (hundreds of times)
5. **Total peak:** **3.5-4GB+** (plus GC overhead = 8-16GB+)

## Fixes Implemented

### Fix 1: Bounded LRU Cache for Embeddings (PENDING)
Replace unbounded Map with LRU cache with size limit:
```typescript
import { LRUCache } from 'lru-cache';

private cache = new LRUCache<string, number[]>({
  max: 10000, // Max 10,000 cached embeddings
  maxSize: 100 * 1024 * 1024, // Max 100MB total
  sizeCalculation: (value, key) => {
    const textBytes = Buffer.byteLength(key.split(':')[1] || '');
    const vectorBytes = value.length * 4; // float32
    return textBytes + vectorBytes;
  },
  ttl: 1000 * 60 * 60 // 1 hour TTL
});
```

### Fix 2: Defer ANN Index Creation (PENDING)
Only create ANN index after all indexing is complete:
```typescript
// Add a flag to VectorService to defer indexing
private deferIndexing = false;

async startTableIndexing(type: TableType) {
  this.deferIndexing = true;
}

async finishTableIndexing(type: TableType) {
  this.deferIndexing = false;
  const table = await this.getOrCreateTable(type);
  // Create index once
  await (table as any).createIndex('vector', { ... });
}
```

### Fix 3: Reduce Parallel Workers During Indexing (PENDING)
Dynamically adjust worker count based on available memory:
```typescript
// Get available heap size
const used = process.memoryUsage().heapUsed / 1024 / 1024;
const total = process.memoryUsage().heapTotal / 1024 / 1024;
const ratio = used / total;

// Reduce workers if memory pressure is high
if (ratio > 0.7) {
  this.maxWorkers = 2;
} else {
  this.maxWorkers = 4;
}
```

### Fix 4: Clear Cache During Indexing (PENDING)
Call `clearCache()` periodically:
```typescript
// In IndexOrchestrator.processItem
if (this.indexedCount % 50 === 0) {
  const embeddingService = getEmbeddingService();
  embeddingService.clearCache();
  console.log('[IndexOrchestrator] Cleared embedding cache');
}
```

## Monitoring

Add memory usage logging:
```typescript
setInterval(() => {
  const mem = process.memoryUsage();
  console.log(`[Memory] heapUsed: ${(mem.heapUsed / 1024 / 1024).toFixed(2)}MB, heapTotal: ${(mem.heapTotal / 1024 / 1024).toFixed(2)}MB`);
}, 5000);
```

## Related Files
- `electron/services/vector/EmbeddingService.ts`
- `electron/services/vector/VectorService.ts`
- `electron/services/indexing/IndexOrchestrator.ts`
- `electron/workers/indexing/v2-parser-worker.ts`