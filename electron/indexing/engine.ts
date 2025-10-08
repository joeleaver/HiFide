

export type EmbeddingEngine = {
  id: string
  dim: number
  embed: (texts: string[]) => Promise<number[][]>
}

// Very small, dependency-free local embedder (placeholder) using hashing over character n-grams.
class SimpleLocalEmbedder implements EmbeddingEngine {
  id = 'simple-hash-emb-384'
  dim = 384
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t))
  }
  private embedOne(t: string): number[] {
    const d = new Array(this.dim).fill(0)
    const s = t.toLowerCase()
    for (let i = 0; i < s.length - 2; i++) {
      const tri = s.slice(i, i + 3)
      let h = 2166136261
      for (let j = 0; j < tri.length; j++) {
        h ^= tri.charCodeAt(j)
        h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)
      }
      const idx = Math.abs(h) % this.dim
      d[idx] += 1
    }
    // L2 normalize
    let norm = Math.sqrt(d.reduce((acc, v) => acc + v * v, 0)) || 1
    return d.map((v) => v / norm)
  }
}

export async function getLocalEngine(): Promise<EmbeddingEngine> {
  // Try to load a local embedding model from fastembed at runtime without type dependency
  try {
    const { createRequire } = await import('node:module')
    const req = createRequire(import.meta.url)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fe: any = req('fastembed')
    const model = process.env.HIFIDE_EMB_MODEL || 'bge-small-en-v1.5'
    const instance: any = fe?.default ? new fe.default(model) : new fe.FastEmbed(model)
    const id = `fastembed-${model}`
    const dim = 384
    const embed = async (texts: string[]): Promise<number[][]> => {
      const res = await instance.embed(texts)
      return res as number[][]
    }
    return { id, dim, embed }
  } catch {
    return new SimpleLocalEmbedder()
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / ((Math.sqrt(na) || 1) * (Math.sqrt(nb) || 1))
}

