import type { AgentTool } from '../../providers/provider'
import { astGrepRewrite } from '../astGrep'

/**
 * High-level wrapper: replace function calls while preserving arguments.
 *
 * Examples:
 * - callee: "console.log", newCallee: "console.debug"  -> console.log($ARGS) => console.debug($ARGS)
 * - callee: "myFn", newCallee: "yourFn"
 */
export const replaceCallTool: AgentTool = {
  name: 'code.replace_call',
  description:
    'Replace function/method calls while preserving arguments using ast-grep. Prefer this for refactors instead of raw text replace. Works with dotted callees like console.log.',
  parameters: {
    type: 'object',
    properties: {
      callee: { type: 'string', description: 'Existing callee name (e.g., console.log or myFn)' },
      newCallee: { type: 'string', description: 'New callee name (e.g., console.debug or yourFn)' },
      languages: { type: 'array', items: { type: 'string' }, description: "Optional languages; default 'auto'" },
      includeGlobs: { type: 'array', items: { type: 'string' } },
      excludeGlobs: { type: 'array', items: { type: 'string' } },
      perFileLimit: { type: 'integer', minimum: 1, maximum: 1000 },
      totalLimit: { type: 'integer', minimum: 1, maximum: 10000 },
      maxFileBytes: { type: 'integer', minimum: 1 },
      concurrency: { type: 'integer', minimum: 1, maximum: 32 },
      dryRun: { type: 'boolean' },
      rangesOnly: { type: 'boolean' },
      cwd: { type: 'string', description: 'Override workspace root (testing/advanced)' }
    },
    required: ['callee', 'newCallee'],
    additionalProperties: false
  },
  run: async (input: {
    callee: string
    newCallee: string
    languages?: string[] | 'auto'
    includeGlobs?: string[]
    excludeGlobs?: string[]
    perFileLimit?: number
    totalLimit?: number
    maxFileBytes?: number
    concurrency?: number
    dryRun?: boolean
    rangesOnly?: boolean
    cwd?: string
  }) => {
    const callee = input.callee.trim()
    const newCallee = input.newCallee.trim()
    if (!callee || !newCallee) return { ok: false, error: 'callee and newCallee are required' }

    // Build simple call pattern and rewrite preserving any number of args
    const pattern = `${callee}($$ARGS)`
    const rewrite = `${newCallee}($$ARGS)`

    try {
      const res = await astGrepRewrite({
        pattern,
        rewrite,
        languages: input.languages && input.languages.length ? input.languages : 'auto',
        includeGlobs: input.includeGlobs,
        excludeGlobs: input.excludeGlobs,
        perFileLimit: input.perFileLimit,
        totalLimit: input.totalLimit,
        maxFileBytes: input.maxFileBytes,
        concurrency: input.concurrency,
        dryRun: input.dryRun,
        rangesOnly: input.rangesOnly
      })

      // If AST rewrite produced no changes, fall back to a conservative text-based replacement
      if ((res?.changes?.length ?? 0) === 0 || (res?.stats?.matchedCount ?? 0) === 0) {
        if (input.dryRun) {
          return { ok: true, ...res }
        }
        const fg = (await import('fast-glob')).default
        const path = await import('node:path')
        const fs = await import('node:fs/promises')
        const cwd = path.resolve(input.cwd || process.cwd())
        const include = (input.includeGlobs && input.includeGlobs.length ? input.includeGlobs : ['**/*'])
        const exclude = ['node_modules/**','dist/**','dist-electron/**','release/**','.git/**', ...(input.excludeGlobs || [])]
        const files: string[] = await fg(include, { cwd, ignore: exclude, absolute: true, onlyFiles: true, dot: false })

        let changedFiles = 0
        let matchedCount = 0
        const rx = new RegExp(`\\b${callee.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`, 'g')
        for (const file of files) {
          let content = ''
          try { content = await fs.readFile(file, 'utf-8') } catch { continue }
          if (!content) continue
          if (!rx.test(content)) continue
          matchedCount += 1
          const next = content.replace(rx, `${newCallee}(`)
          if (next !== content) {
            await fs.writeFile(file, next, 'utf-8')
            changedFiles += 1
          }
        }
        return {
          ok: true,
          changes: [],
          truncated: false,
          stats: { scannedFiles: files.length, matchedCount, changedFiles, durationMs: 0 }
        } as any
      }

      return { ok: true, ...res }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  }
}

export default replaceCallTool

