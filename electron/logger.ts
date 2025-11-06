import { app } from 'electron'
import path from 'node:path'
import log from 'electron-log/main.js'
import type { LevelOption, LogMessage } from 'electron-log'

// Initialize electron-log early in main
log.initialize()

// Configure levels (env override supported)
const rawLevel = (process.env.HIFIDE_LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info'))
const allowedLevels = ['error','warn','info','verbose','debug','silly'] as const
const level = (allowedLevels.includes(rawLevel as any) ? (rawLevel as LevelOption) : 'info') as LevelOption

log.transports.file.level = level

// Rotate at ~10MB; keep 7 files
;(log.transports.file as any).maxSize = 10 * 1024 * 1024
;(log.transports.file as any).maxFiles = 7

// File location (per-process file)
log.transports.file.resolvePath = () => path.join(app.getPath('logs'), 'hifide-main.log')

// Basic redaction of common secrets in messages
function redactString(input: string): string {
  let s = input
  // Authorization headers
  s = s.replace(/(Authorization\s*:\s*Bearer\s+)([A-Za-z0-9._~+\/-=]{6,})/gi, '$1***REDACTED***')
  // Generic key-style pairs: api_key, x-api-key, token
  s = s.replace(/(["'\s\[]?(?:x?-?api-?key|api_?key|authorization|bearer|token)["'\]\s]*[:=]\s*["']?)([A-Za-z0-9._~+\/-=]{6,})(["']?)/gi, '$1***REDACTED***$3')
  // Common provider prefixes
  s = s.replace(/\b(sk-[A-Za-z0-9]{10,}|gsk_[A-Za-z0-9]{10,}|hf_[A-Za-z0-9]{10,})\b/g, '***REDACTED***')
  return s
}

function isPlainObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype
}

function redactObject<T>(input: T, depth = 0, maxDepth = 3): T {
  if (depth > maxDepth || !isPlainObject(input)) return input
  const out: Record<string, any> = Array.isArray(input) ? [] : {}
  for (const [k, v] of Object.entries(input)) {
    const key = String(k)
    if (/(?:^|_|-)(?:api|x)?-?key$|authorization|bearer|token/i.test(key)) {
      out[key] = '***REDACTED***'
      continue
    }
    if (typeof v === 'string') out[key] = redactString(v)
    else if (isPlainObject(v)) out[key] = redactObject(v, depth + 1, maxDepth)
    else out[key] = v
  }
  return out as T
}

function redact(data: any): any {
  try {
    if (typeof data === 'string') return redactString(data)
    if (data instanceof Error) {
      const e = data as Error & { stack?: string }
      const copy: any = { name: e.name, message: redactString(String(e.message || '')), stack: e.stack ? redactString(e.stack) : undefined }
      return copy
    }
    if (isPlainObject(data) || Array.isArray(data)) return redactObject(data)
    return data
  } catch {
    return data
  }
}

log.hooks.push((message: LogMessage) => {
  try {
    message.data = (message.data || []).map((d: any) => redact(d))
  } catch {}
  return message
})

// Capture unhandled errors without user dialogs
;(log as any).catchErrors?.({ showDialog: false })

// Patch console.* to also write to file
let patched = false
if (!patched) {
  patched = true
  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
  }
  const map: Record<string, keyof typeof log> = {
    log: 'info',
    info: 'info',
    warn: 'warn',
    error: 'error',
    debug: 'debug',
  }
  ;(['log', 'info', 'warn', 'error', 'debug'] as const).forEach((fn) => {
    ;(console as any)[fn] = (...args: any[]) => {
      try {
        ;(log as any)[map[fn]]?.(...args)
      } catch {}
      try {
        ;(orig as any)[fn](...args)
      } catch {}
    }
  })
}

export default log

