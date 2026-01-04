import { getSettingsService } from '../index.js';
import { Worker } from 'worker_threads';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

export class EmbeddingService {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, { resolve: Function, reject: Function }>();
  private requestIdCounter = 0;
  private cache = new Map<string, number[]>();

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
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

    const provider = modelName.startsWith('text-embedding-3') ? 'openai' : 'local';

    let vector: number[];
    if (provider === 'openai') {
      vector = await this.embedOpenAI(text, modelName);
    } else {
      vector = await this.embedLocal(text, modelId, type);
    }

    this.cache.set(cacheKey, vector);
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

  clearCache() {
    this.cache.clear();
  }
}
