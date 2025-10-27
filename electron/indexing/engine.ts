

export type EmbeddingEngine = {
  id: string
  dim: number
  embed: (texts: string[]) => Promise<number[][]>
}

// --- Backends ---------------------------------------------------------------------------


async function getTransformersEngine(): Promise<EmbeddingEngine> {
  const { pipeline, env } = await import('@xenova/transformers') as any
  // Configure a writable, cross-platform local cache for model files
  try {
    const pathMod = await import('node:path')
    const osMod = await import('node:os')
    let modelDir: string | undefined
    try {
      const { app } = await import('electron')
      if (app && typeof app.getPath === 'function') {
        const base = app.getPath('userData')
        modelDir = pathMod.join(base, 'models', 'transformers')
      }
    } catch {}
    if (!modelDir) {
      const home = (osMod as any).homedir?.() || process.env.HOME || process.cwd()
      modelDir = pathMod.join(home, '.hifide', 'models', 'transformers')
    }
    try { (await import('node:fs')).mkdirSync(modelDir, { recursive: true }) } catch {}
    env.localModelPath = env.localModelPath || modelDir
  } catch {}
  env.allowLocalModels = true
  try {
    const eany: any = env as any
    eany.backends = eany.backends || {}
    // Prefer WASM backend to avoid native onnxruntime-node in Electron dev
    eany.backends.onnx = 'wasm'
  } catch {}

  const model = process.env.HIFIDE_EMB_MODEL_TRANSFORMERS || 'Xenova/all-MiniLM-L6-v2'
  const extractor = await pipeline('feature-extraction', model)
  const id = `transformers-${model}`
  // all-MiniLM-L6-v2 hidden size is 384; fall back to first vector length if different
  let dim = 384

  const meanPool = (tensor: any): number[] => {
    // tensor may be a Tensor or TypedArray depending on options; try to use built-in pooling when available
    // If pipeline supports pooling/normalize options, prefer them.
    if (Array.isArray(tensor)) return tensor as number[]
    const data: Float32Array = tensor?.data || tensor?.toData?.() || tensor?.tolist?.() || []
    // If already 1D, assume normalized
    if (Array.isArray(data) || (data && (data as any).length && (tensor?.dims?.length === 1))) {
      return Array.from(data as any)
    }
    // Fallback: assume shape [1, seq_len, hidden]
    const dims: number[] = (tensor?.dims as number[]) || []
    const hidden = dims.length >= 3 ? dims[dims.length - 1] : dim
    const seq = dims.length >= 3 ? dims[dims.length - 2] : 1
    const arr: number[] = new Array(hidden).fill(0)
    const flat: Float32Array = tensor?.data as any
    if (flat && flat.length) {
      for (let t = 0; t < seq; t++) {
        for (let h = 0; h < hidden; h++) arr[h] += flat[t * hidden + h] || 0
      }
      for (let h = 0; h < hidden; h++) arr[h] = arr[h] / Math.max(1, seq)
    }
    // L2 normalize
    let nrm = 0
    for (let h = 0; h < hidden; h++) nrm += arr[h] * arr[h]
    nrm = Math.sqrt(nrm) || 1
    for (let h = 0; h < hidden; h++) arr[h] = arr[h] / nrm
    return arr
  }

  const embed = async (texts: string[]): Promise<number[][]> => {
    const out: number[][] = []
    for (const t of texts) {
      // Use built-in pooling/normalize when available
      let res: any
      try {
        res = await extractor(t, { pooling: 'mean', normalize: true })
      } catch {
        res = await extractor(t)
      }
      const v = meanPool(res)
      if (Array.isArray(v) && v.length) dim = v.length
      out.push(v)
    }
    return out
  }

  return { id, dim, embed }
}

function getMockEngine(): EmbeddingEngine {
  const dim = 384
  const id = 'mock-embeddings-384'
  const embed = async (texts: string[]): Promise<number[][]> => {
    const vecs: number[][] = []
    for (const t of texts) {
      const v = new Array(dim).fill(0)
      // Very simple bag-of-words hashing for tests
      const tokens = String(t || '').toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean)
      for (const tok of tokens) {
        let h = 2166136261
        for (let i = 0; i < tok.length; i++) h = (h ^ tok.charCodeAt(i)) * 16777619 >>> 0
        const idx = h % dim
        v[idx] += 1
      }
      // L2 normalize
      let nrm = 0
      for (let i = 0; i < dim; i++) nrm += v[i] * v[i]
      nrm = Math.sqrt(nrm) || 1
      for (let i = 0; i < dim; i++) v[i] = v[i] / nrm
      vecs.push(v)
    }
    return vecs
  }
  return { id, dim, embed }
}

// Local engine: transformers.js preferred; fallback to mock in test/CI
export async function getLocalEngine(): Promise<EmbeddingEngine> {
  try {
    return await getTransformersEngine()
  } catch (e) {
    console.warn('[indexing] transformers backend unavailable; using mock embeddings for tests')
    return getMockEngine()
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

