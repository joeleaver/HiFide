

export type EmbeddingEngine = {
  id: string
  dim: number
  embed: (texts: string[]) => Promise<number[][]>
}

// Required fastembed engine. We use dynamic import to respect ESM and avoid CJS.
export async function getLocalEngine(): Promise<EmbeddingEngine> {
  const mod = await import('fastembed').catch((e) => {
    const hint = 'fastembed not found. Please install it: pnpm add fastembed'
    throw new Error(`[embedding] Failed to load fastembed: ${String(e?.message || e)}. ${hint}`)
  })
  const { EmbeddingModel, FlagEmbedding } = mod as any
  if (!FlagEmbedding) throw new Error('[embedding] fastembed module does not export FlagEmbedding')

  const resolveModel = (name: string | undefined) => {
    const n = (name || '').toLowerCase().trim()
    // Accept both canonical and short aliases
    if (!n || n === 'bge-small-en-v1.5' || n === 'fast-bge-small-en-v1.5') return EmbeddingModel?.BGESmallENV15 ?? 'fast-bge-small-en-v1.5'
    if (n === 'bge-base-en-v1.5' || n === 'fast-bge-base-en-v1.5') return EmbeddingModel?.BGEBaseENV15 ?? 'fast-bge-base-en-v1.5'
    if (n === 'bge-small-en' || n === 'fast-bge-small-en') return EmbeddingModel?.BGESmallEN ?? 'fast-bge-small-en'
    if (n === 'bge-base-en' || n === 'fast-bge-base-en') return EmbeddingModel?.BGEBaseEN ?? 'fast-bge-base-en'
    if (n === 'all-minilm-l6-v2' || n === 'fast-all-minilm-l6-v2') return EmbeddingModel?.AllMiniLML6V2 ?? 'fast-all-MiniLM-L6-v2'
    // Fallback to provided string; fastembed will error if invalid
    return name
  }

  const modelInput = process.env.HIFIDE_EMB_MODEL || 'fast-bge-small-en-v1.5'
  const model = resolveModel(modelInput)
  const instance: any = await FlagEmbedding.init({ model })

  // Determine dim from supported models list
  let dim = 384
  try {
    const info = instance.listSupportedModels?.() || []
    const match = info.find((m: any) => m.model === model)
    if (match?.dim) dim = match.dim
  } catch {}

  const id = `fastembed-${typeof model === 'string' ? model : String(model)}`
  const embed = async (texts: string[]): Promise<number[][]> => {
    const out: number[][] = []
    // FlagEmbedding.embed returns an AsyncGenerator of number[][] batches
    const gen: AsyncGenerator<number[][]> = instance.embed(texts)
    for await (const batch of gen) {
      for (const v of batch) out.push(v)
    }
    return out
  }
  return { id, dim, embed }
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

