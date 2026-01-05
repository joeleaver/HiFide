import log from 'electron-log/renderer.js'


const envAny = ((import.meta as any)?.env || {}) as any
// Default to 'info' even in development to reduce noise; use VITE_HIFIDE_LOG_LEVEL=debug to enable verbose logging
const level = (envAny.VITE_HIFIDE_LOG_LEVEL || envAny.VITE_LOG_LEVEL || 'info') as
  | 'silly'
  | 'verbose'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal'

const transportsAny = (log as any).transports || {}
if (transportsAny.console) transportsAny.console.level = level
if (transportsAny.file) {
  transportsAny.file.level = level
  transportsAny.file.maxSize = 10 * 1024 * 1024
  transportsAny.file.maxFiles = 7
  transportsAny.file.fileName = 'hifide-renderer.log'
} else {
  ;(log as any).level = level
}


function redactString(input: string): string {
  let s = input
  s = s.replace(/(Authorization\s*:\s*Bearer\s+)([A-Za-z0-9._~+\/-=]{6,})/gi, '$1***REDACTED***')
  s = s.replace(/(["'\s\[]?(?:x?-?api-?key|api_?key|authorization|bearer|token)["'\]\s]*[:=]\s*["']?)([A-Za-z0-9._~+\/-=]{6,})(["']?)/gi, '$1***REDACTED***$3')
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
    // Only redact keys that are actual secrets (API keys, auth tokens), not token counts
    if (/(?:^|_|-)(?:api|x)?-?key$|authorization|bearer|^token$/i.test(key)) {
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

log.hooks.push((message: any) => {
  try {
    message.data = (message.data || []).map((d: any) => redact(d))
  } catch {}
  return message
})

// Swallow benign flow-cancellation unhandled rejections to avoid noisy logs in devtools
// Must run before electron-log's catchErrors hooks so we can stop propagation
try {
  window.addEventListener(
    'unhandledrejection',
    (ev: PromiseRejectionEvent) => {
      try {
        const reason: any = (ev as any)?.reason
        const text = reason?.message || reason?.stack || String(reason)
        const isCancellation =
          (reason && reason.name === 'AbortError') || /\b(cancel|canceled|cancelled|abort|aborted|terminate|terminated|stop|stopped)\b/i.test(text)
        if (isCancellation) {
          // Swallow cancellation silently; no console spam
          ev.preventDefault?.()
          // Stop other listeners (including electron-log) from logging this event
          try { (ev as any).stopImmediatePropagation?.() } catch {}
        }
      } catch {}
    },
    { capture: true }
  )
} catch {}

;(log as any).catchErrors?.({ showDialog: false })

// Patch console to also write to file via electron-log
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

