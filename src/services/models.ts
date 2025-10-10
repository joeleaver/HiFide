export async function listModels(provider: string) {
  try {
    return await window.models?.list?.(provider)
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

