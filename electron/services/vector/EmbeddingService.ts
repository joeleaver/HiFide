import { getSettingsService } from '../index.js';
import { Worker } from 'worker_threads';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Simple LRU Cache implementation
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;
  private maxBytes: number;
  private currentBytes: number;

  constructor(maxSize: number, maxBytes: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.maxBytes = maxBytes;
    this.currentBytes = 0;
  }

  set(key: K, value: V, sizeInBytes?: number): void {
    // Calculate size if not provided
    const size = sizeInBytes ?? this.estimateSize(key, value);

    // If key exists, remove old entry first
    if (this.cache.has(key)) {
      this.delete(key);
    }

    // Evict entries until we have space
    while (
      (this.cache.size >= this.maxSize || this.currentBytes + size > this.maxBytes) &&
      this.cache.size > 0
    ) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.delete(firstKey);
      }
    }

    // Add new entry
    this.cache.set(key, value);
    this.currentBytes += size;
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;

    // Move to end (most recently used)
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    if (!this.cache.has(key)) return false;

    const value = this.cache.get(key)!;
    const size = this.estimateSize(key, value);
    this.cache.delete(key);
    this.currentBytes -= size;
    return true;
  }

  clear(): void {
    this.cache.clear();
    this.currentBytes = 0;
  }

  get size(): number {
    return this.cache.size;
  }

  get bytesUsed(): number {
    return this.currentBytes;
  }

  private estimateSize(key: K, value: V): number {
    // Rough estimation: string key bytes + vector size (float32 array)
    const keySize = typeof key === 'string' ? Buffer.byteLength(key) : 8;
    const valueSize = Array.isArray(value) ? value.length * 4 : 8;
    return keySize + valueSize;
  }
}

export class EmbeddingService {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, { resolve: Function, reject: Function }>();
  private requestIdCounter = 0;
  
  // Bounded LRU cache to prevent OOM during indexing
  // Max 10,000 entries or 100MB total
  private cache = new LRUCache<string, number[]>(10000, 100 * 1024 * 1024);

  private async getWorker(): Promise<Worker> {
    if (this.worker) return this.worker;

    // Robust ESM-compatible path resolution
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const potentialPaths = [
      path.resolve(currentDir, 'embedding-worker.mjs'), // Prod
      path.resolve(currentDir, 'workers', 'embedding-worker.js'), // Dev
      path.resolve(currentDir, '..', 'embedding-worker.mjs'), // Sibling dist
    ];

    const workerPath = potentialPaths.find(p => fs.existsSync(p));

    if (!workerPath) {
      throw new Error(`Embedding worker not found. Searched in: ${potentialPaths.join(', ')}`);
    }

    console.log(`[EmbeddingService] Spawning worker at: ${workerPath}`);
    this.worker = new Worker(workerPath);

    this.worker.on('message', (message) => {
      const { id, type, payload } = message;
      const deferred = this.pendingRequests.get(id);
      if (!deferred) return;

      if (type === 'success') {
        deferred.resolve(payload);
      } else {
        deferred.reject(new Error(payload));
      }
      this.pendingRequests.delete(id);
    });

    this.worker.on('error', (err) => {
      console.error('[EmbeddingService] Worker thread error:', err);
      // Reject all pending requests on crash
      for (const [id, deferred] of this.pendingRequests.entries()) {
        deferred.reject(err);
        this.pendingRequests.delete(id);
      }
      this.worker = null;
    });

    return this.worker;
  }

  async getDimension(type?: 'code' | 'kb' | 'memories'): Promise<number> {
    const settings = (getSettingsService() as any).state;
    const vectorSettings = settings.vector;
    
    // Determine model ID for this table
    let modelId = vectorSettings?.localModel || 'Xenova/all-MiniLM-L6-v2';
    if (type === 'code' && vectorSettings?.codeLocalModel) modelId = vectorSettings.codeLocalModel;
    if (type === 'kb' && vectorSettings?.kbLocalModel) modelId = vectorSettings.kbLocalModel;
    if (type === 'memories' && vectorSettings?.memoriesLocalModel) modelId = vectorSettings.memoriesLocalModel;

    // Use specific model from UI choice to determine provider if needed
    let modelName = vectorSettings?.model || '';
    if (type === 'code' && vectorSettings?.codeModel) modelName = vectorSettings.codeModel;
    if (type === 'kb' && vectorSettings?.kbModel) modelName = vectorSettings.kbModel;
    if (type === 'memories' && vectorSettings?.memoriesModel) modelName = vectorSettings.memoriesModel;

    if (modelName.startsWith('text-embedding-3')) {
      return modelName.includes('large') ? 3072 : 1536;
    }

    if (modelId.includes('nomic')) {
      return 768;
    }
    return 384;
  }

  async embed(text: string, type?: 'code' | 'kb' | 'memories'): Promise<number[]> {
    const settings = (getSettingsService() as any).state;
    const vectorSettings = settings.vector;

    let modelId = vectorSettings?.localModel || 'Xenova/all-MiniLM-L6-v2';
    if (type === 'code' && vectorSettings?.codeLocalModel) modelId = vectorSettings.codeLocalModel;
    if (type === 'kb' && vectorSettings?.kbLocalModel) modelId = vectorSettings.kbLocalModel;
    if (type === 'memories' && vectorSettings?.memoriesLocalModel) modelId = vectorSettings.memoriesLocalModel;

    let modelName = vectorSettings?.model || '';
    if (type === 'code' && vectorSettings?.codeModel) modelName = vectorSettings.codeModel;
    if (type === 'kb' && vectorSettings?.kbModel) modelName = vectorSettings.kbModel;
    if (type === 'memories' && vectorSettings?.memoriesModel) modelName = vectorSettings.memoriesModel;

    const cacheKey = `${modelId}:${text}`;
    
    // Check cache
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        // Log cache hit periodically (every 100th hit)
        if (Math.random() < 0.01) {
          const stats = this.getCacheStats();
          console.log(`[EmbeddingService] Cache hit. Stats: ${stats.size} entries, ${stats.bytesUsedMB.toFixed(2)}MB`);
        }
        return cached;
      }
    }

    // Generate embedding
    const provider = modelName.startsWith('text-embedding-3') ? 'openai' : 'local';

    let vector: number[];
    if (provider === 'openai') {
      vector = await this.embedOpenAI(text, modelName);
    } else {
      vector = await this.embedLocal(text, modelId, type);
    }

    // Store in cache
    this.cache.set(cacheKey, vector);
    
    // Log cache size periodically
    if (Math.random() < 0.01) {
      const stats = this.getCacheStats();
      console.log(`[EmbeddingService] Cache miss. Stats: ${stats.size} entries, ${stats.bytesUsedMB.toFixed(2)}MB`);
    }
    
    return vector;
  }

  private async embedOpenAI(_text: string, modelName: string): Promise<number[]> {
    const dim = modelName.includes('large') ? 3072 : 1536;
    return new Array(dim).fill(0).map(() => Math.random());
  }

  private async embedLocal(text: string, modelId: string, type?: 'code' | 'kb' | 'memories'): Promise<number[]> {
    try {
      const worker = await this.getWorker();
      const id = `req-${++this.requestIdCounter}`;

      return new Promise((resolve, reject) => {
        this.pendingRequests.set(id, { resolve, reject });
        worker.postMessage({
          id,
          type: 'embed',
          payload: { text, modelId }
        });
      });
    } catch (error) {
      console.error(`[EmbeddingService] Local embedding failed for ${modelId}, falling back to deterministic hash:`, error);

      // Fallback to deterministic hash
      const dim = await this.getDimension(type);
      const vector = new Array(dim).fill(0.1);
      for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);
        const index = (i * 31) % dim;
        vector[index] += charCode / 255;
      }
      const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1;
      return vector.map(v => v / magnitude);
    }
  }

  clearCache(): { size: number; bytesUsed: number } {
    const before = { size: this.cache.size, bytesUsed: this.cache.bytesUsed };
    this.cache.clear();
    console.log(`[EmbeddingService] Cleared cache: ${before.size} entries, ${(before.bytesUsed / 1024 / 1024).toFixed(2)}MB`);
    return before;
  }

  getCacheStats(): { size: number; bytesUsed: number; bytesUsedMB: number } {
    return {
      size: this.cache.size,
      bytesUsed: this.cache.bytesUsed,
      bytesUsedMB: this.cache.bytesUsed / 1024 / 1024
    };
  }
}
