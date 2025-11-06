import Ajv, { ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'

// Simple shared JSON Schema validator with caching
const ajv = new Ajv({ allErrors: false })
addFormats(ajv)
const cache = new WeakMap<object, ValidateFunction>()

export function validateJson(schema: any, data: any): { ok: boolean; errors?: string } {
  if (!schema || typeof schema !== 'object') return { ok: true }
  let v = cache.get(schema)
  if (!v) {
    try {
      v = ajv.compile(schema)
      cache.set(schema, v)
    } catch (e: any) {
      return { ok: false, errors: 'schema-compile-error: ' + (e?.message || String(e)) }
    }
  }
  const ok = (v as ValidateFunction)(data) as boolean
  if (ok) return { ok: true }
  const msg = (v as ValidateFunction).errors?.map((e: any) => `${e.instancePath || e.dataPath || ''} ${e.message || ''}`).join('; ')
  return { ok: false, errors: msg || 'validation-failed' }
}

