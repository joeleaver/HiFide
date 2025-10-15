/**
 * Secrets and provider API key management IPC handlers
 * 
 * Handles secure storage, validation, and presence checking for provider API keys
 */

import type { IpcMain } from 'electron'
import {
  setProviderKey,
  getProviderKeyFromMemory,
  getProviderKey,
  computeProviderPresence,
  broadcastProviderPresence,
} from '../core/state'


/**
 * Pick a cheap classification-capable model by heuristic
 */
async function pickCheapestClassifierModel(providerId: string, apiKey: string): Promise<string> {
  try {
    if (providerId === 'openai') {
      const { default: OpenAI } = await import('openai')
      const client = new OpenAI({ apiKey })
      const res: any = await client.models.list()
      const ids: string[] = (res?.data || []).map((m: any) => m?.id).filter((id: any) => typeof id === 'string')
      const allowed = ids.filter((id) => /^(gpt-5|gpt-4\.1|gpt-4o|o[34])/i.test(id) && !/realtime|whisper|audio|tts|speech|embedding|embeddings/i.test(id))
      const rank = (id: string) => (/nano/i.test(id) ? 1 : /mini/i.test(id) ? 2 : /o4-mini|4o-mini/i.test(id) ? 2 : 3)
      const chosen = allowed.sort((a, b) => (rank(a) - rank(b)) || a.localeCompare(b))[0]
      return chosen || 'gpt-5-nano'
    }
    if (providerId === 'anthropic') {
      const f: any = (globalThis as any).fetch
      if (!f) return 'claude-3-5-haiku'
      const resp = await f('https://api.anthropic.com/v1/models', { method: 'GET', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } })
      const data = await resp.json().catch(() => ({}))
      const arr = Array.isArray((data as any).data) ? (data as any).data : Array.isArray((data as any).models) ? (data as any).models : []
      const ids: string[] = arr.map((m: any) => m?.id || m?.name).filter(Boolean)
      const allowed = ids.filter((id) => /^(claude-3(\.7)?|claude-3-5)/i.test(id))
      const rank = (id: string) => (/haiku/i.test(id) ? 1 : /sonnet/i.test(id) ? 2 : 3)
      const chosen = allowed.sort((a, b) => (rank(a) - rank(b)) || a.localeCompare(b))[0]
      return chosen || 'claude-3-5-haiku'
    }
    if (providerId === 'gemini') {
      const f: any = (globalThis as any).fetch
      if (!f) return 'gemini-2.5-flash-lite'
      const resp = await f(`https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(apiKey)}`, { method: 'GET' })
      const data = await resp.json().catch(() => ({}))
      const arr = Array.isArray((data as any).models) ? (data as any).models : Array.isArray((data as any).data) ? (data as any).data : []
      const models = arr.map((m: any) => {
        const full = (m?.name || m?.model || '').toString()
        const id = full.startsWith('models/') ? full.split('/').pop() : full
        const supported: string[] = (m?.supportedGenerationMethods || m?.supported_generation_methods || [])
        return { id, supported }
      }).filter((m: any) => m.supported?.includes('generateContent') && !/(embedding|vision|image-generation)/i.test(m.id))
      const rank = (id: string) => (/flash\-lite/i.test(id) ? 1 : /flash/i.test(id) ? 2 : 3)
      const chosen = models.map((m:any)=>m.id).sort((a: string, b: string) => (rank(a) - rank(b)) || a.localeCompare(b))[0]
      return chosen || 'gemini-2.5-flash-lite'
    }
  } catch {}
  // Fallbacks per provider
  if (providerId === 'anthropic') return 'claude-3-5-haiku'
  if (providerId === 'gemini') return 'gemini-2.5-flash-lite'
  return 'gpt-5-nano'
}

/**
 * Register secrets IPC handlers
 */
export function registerSecretsHandlers(ipcMain: IpcMain): void {
  /**
   * Set OpenAI API key (legacy handler for backward compatibility)
   */
  ipcMain.handle('secrets:set', async (_e, k: string) => {
    setProviderKey('openai', k)
    broadcastProviderPresence()
    return true
  })

  /**
   * Set API key for a specific provider
   */
  ipcMain.handle('secrets:setFor', async (_e, args: { provider: string; key: string }) => {
    setProviderKey(args.provider, args.key)
    broadcastProviderPresence()
    return true
  })

  /**
   * Get API key for a specific provider
   */
  ipcMain.handle('secrets:getFor', async (_e, provider: string) => {
    return await getProviderKey(provider)
  })

  /**
   * Get OpenAI API key (legacy handler for backward compatibility)
   */
  ipcMain.handle('secrets:get', async () => {
    const v = getProviderKeyFromMemory('openai')
    return typeof v === 'string' ? v : null
  })

  /**
   * Validate provider API key
   */
  ipcMain.handle('secrets:validateFor', async (_e, args: { provider: string; key: string; model?: string }) => {
    const { provider, key, model } = args
    try {
      if (!key || key.trim().length < 10) {
        return { ok: false, error: 'Key missing or too short' }
      }

      if (provider === 'openai') {
        const { default: OpenAI } = await import('openai')
        const client = new OpenAI({ apiKey: key })
        // Light, read-only call
        await client.models.list()
        return { ok: true }
      }

      if (provider === 'anthropic') {
        const { default: Anthropic } = await import('@anthropic-ai/sdk')
        const c = new Anthropic({ apiKey: key })
        const m = model || 'claude-3-5-sonnet'
        // Very cheap token count
        await c.messages.countTokens({ model: m as any, messages: [{ role: 'user', content: 'ping' }] as any })
        return { ok: true }
      }

      if (provider === 'gemini') {
        // Validate with public listModels on v1
        try {
          const url = `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(key)}`
          const f: any = (globalThis as any).fetch
          if (!f) {
            return { ok: false, error: 'Fetch API unavailable in main process to validate Gemini key' }
          }
          const resp = await f(url, { method: 'GET' })
          if (resp.ok) {
            const data = await resp.json().catch(() => ({}))
            if (data && (Array.isArray((data as any).models) || Array.isArray((data as any).data))) {
              return { ok: true }
            }
            // If response body is empty but 200 OK, treat as valid
            return { ok: true }
          } else {
            const txt = await resp.text().catch(() => '')
            return { ok: false, error: `Gemini listModels HTTP ${resp.status}: ${txt.slice(0, 300)}` }
          }
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e) }
        }
      }

      return { ok: false, error: 'Unknown provider' }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Check provider presence (which providers have keys available)
   */
  ipcMain.handle('secrets:presence', async () => {
    return computeProviderPresence()
  })

  /**
   * List available models for a provider
   */
  ipcMain.handle('models:list', async (_e, provider: string) => {
    try {
      const prov = provider || 'openai'
      const key = await getProviderKey(prov)
      if (!key) {
        return { ok: false, error: 'Missing API key for provider' }
      }

      if (prov === 'openai') {
        const { default: OpenAI } = await import('openai')
        const client = new OpenAI({ apiKey: key })
        const res: any = await client.models.list()
        const ids: string[] = (res?.data || [])
          .map((m: any) => m?.id)
          .filter((id: any) => typeof id === 'string')
        
        // Filter to models relevant for agentic coding
        const allowPriority = [
          'gpt-5', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4', 'o4-mini', 'o3-mini',
        ]
        const allowed = ids.filter((id) =>
          /^(gpt-5|gpt-4\.1|gpt-4o|o[34])/i.test(id) &&
          !/realtime/i.test(id) &&
          !/(whisper|audio|tts|speech|embedding|embeddings)/i.test(id)
        )
        const uniq = Array.from(new Set(allowed))
        const withLabels = uniq.map((id) => ({ id, label: id }))
        
        // Sort by preferred order
        withLabels.sort((a, b) => {
          const ia = allowPriority.findIndex((p) => a.id.startsWith(p))
          const ib = allowPriority.findIndex((p) => b.id.startsWith(p))
          if (ia !== ib) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
          return a.id.localeCompare(b.id)
        })
        return { ok: true, models: withLabels }
      }

      if (prov === 'anthropic') {
        const f: any = (globalThis as any).fetch
        if (!f) return { ok: false, error: 'Fetch API unavailable in main process' }
        const resp = await f('https://api.anthropic.com/v1/models', {
          method: 'GET',
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        })
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '')
          return { ok: false, error: `Anthropic models HTTP ${resp.status}: ${txt.slice(0, 300)}` }
        }
        const data = await resp.json().catch(() => ({}))
        const arr = Array.isArray((data as any).data)
          ? (data as any).data
          : Array.isArray((data as any).models)
            ? (data as any).models
            : []
        const ids: string[] = arr.map((m: any) => m?.id || m?.name).filter(Boolean)
        // Filter to Claude 3/3.5/3.7 families
        const allowed = ids.filter((id) => /^(claude-3(\.7)?|claude-3-5)/i.test(id))
        const uniq = Array.from(new Set(allowed))
        const withLabels = uniq.map((id) => ({ id, label: id }))
        return { ok: true, models: withLabels }
      }

      if (prov === 'gemini') {
        const f: any = (globalThis as any).fetch
        if (!f) return { ok: false, error: 'Fetch API unavailable in main process' }
        const resp = await f(`https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(key)}`, { method: 'GET' })
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '')
          return { ok: false, error: `Gemini models HTTP ${resp.status}: ${txt.slice(0, 300)}` }
        }
        const data = await resp.json().catch(() => ({}))
        const arr = Array.isArray((data as any).models)
          ? (data as any).models
          : Array.isArray((data as any).data)
            ? (data as any).data
            : []
        const models = arr.map((m: any) => {
          const full = (m?.name || m?.model || '').toString()
          const id = full.startsWith('models/') ? full.split('/').pop() : full
          const supported: string[] = (m?.supportedGenerationMethods || m?.supported_generation_methods || [])
          return { id, label: id, supported }
        }).filter((m: any) => {
          const id = m.id || ''
          const hasGenerate = m.supported?.includes('generateContent')
          const isNotEmbedding = !/(embedding|vision)/i.test(id)
          const isNotImageGen = !/image-generation/i.test(id)
          return hasGenerate && isNotEmbedding && isNotImageGen
        })
        return { ok: true, models }
      }

      return { ok: false, error: 'Unknown provider' }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Get cheapest classifier model for a provider (heuristic)
   */
  ipcMain.handle('models:cheapestClassifier', async (_e, args: { provider: string }) => {
    try {
      const prov = args?.provider || 'openai'
      const key = await getProviderKey(prov)
      if (!key) {
        return { ok: false, error: 'Missing API key for provider' }
      }
      const model = await pickCheapestClassifierModel(prov, key)
      return { ok: true, model }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })
}

