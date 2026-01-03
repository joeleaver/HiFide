import { getSettingsService } from '../index.js';

export class EmbeddingService {
  private cache = new Map<string, number[]>();
  private engine: any = null;

  async getDimension(): Promise<number> {
    const settings = (getSettingsService() as any).state;
    return settings.vector?.provider === 'openai' ? 1536 : 384;
  }

  async embed(text: string): Promise<number[]> {
    if (this.cache.has(text)) return this.cache.get(text)!;

    const settings = (getSettingsService() as any).state;
    const provider = settings.vector?.provider || 'local';

    let vector: number[];
    if (provider === 'openai') {
      vector = await this.embedOpenAI(text);
    } else {
      vector = await this.embedLocal(text);
    }

    this.cache.set(text, vector);
    return vector;
  }

  private async embedOpenAI(_text: string): Promise<number[]> {
    // This would normally call the OpenAI API via ProviderService
    // For now, returning a dummy vector of the correct dimension
    return new Array(1536).fill(0).map(() => Math.random());
  }

  private async embedLocal(_text: string): Promise<number[]> {
    if (!this.engine) {
      // In a real implementation, we would load a model like minilm-l6-v2 here
      // via a native library or transformers.js
      console.log('[EmbeddingService] Initializing local embedding engine...');
      this.engine = true; 
    }
    // Return a dummy vector of the correct dimension
    return new Array(384).fill(0).map(() => Math.random());
  }

  clearCache() {
    this.cache.clear();
  }
}
