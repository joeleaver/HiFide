import type { AgentTool } from '../../providers/provider'
import { resolveWithinWorkspace, atomicWrite, applyFileEditsInternal } from '../utils'
import { astGrepRewrite } from '../astGrep'
import { verifyTypecheck as tsVerify } from '../../refactors/ts'
import fs from 'node:fs/promises'

export const applyEditsTargetedTool: AgentTool = {
  name: 'code.apply_edits_targeted',
  description: 'Apply targeted edits: simple text edits and/or cross-language AST rewrites via ast-grep. Supports dryRun and ranges-only modes.',
  parameters: {
    type: 'object',
    properties: {
      textEdits: {
        type: 'array',
        items: {
          type: 'object',
          oneOf: [
            {
              type: 'object',
              properties: { type: { const: 'replaceOnce' }, path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } },
              required: ['type', 'path', 'oldText', 'newText'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: { type: { const: 'insertAfterLine' }, path: { type: 'string' }, line: { type: 'integer' }, text: { type: 'string' } },
              required: ['type', 'path', 'line', 'text'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: { type: { const: 'replaceRange' }, path: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' }, text: { type: 'string' } },
              required: ['type', 'path', 'start', 'end', 'text'],
              additionalProperties: false,
            },
          ],
        },
      },
      astRewrites: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            rewrite: { type: 'string' },
            languages: { type: 'array', items: { type: 'string' } },
            includeGlobs: { type: 'array', items: { type: 'string' } },
            excludeGlobs: { type: 'array', items: { type: 'string' } },
            perFileLimit: { type: 'integer', minimum: 1, maximum: 1000 },
            totalLimit: { type: 'integer', minimum: 1, maximum: 100000 },
            maxFileBytes: { type: 'integer', minimum: 1 },
            concurrency: { type: 'integer', minimum: 1, maximum: 32 },
          },
          required: ['pattern', 'rewrite'],
          additionalProperties: false,
        },
      },
      advancedTextEdits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            guard: {
              type: 'object',
              properties: { expectedBefore: { type: 'string' }, checksum: { type: 'string' } },
              additionalProperties: false
            },
            selector: {
              oneOf: [
                { type: 'object', properties: { range: { type: 'object', properties: { start: { type: 'object', properties: { line: { type: 'integer' }, column: { type: 'integer' } }, required: ['line','column'] }, end: { type: 'object', properties: { line: { type: 'integer' }, column: { type: 'integer' } }, required: ['line','column'] } }, required: ['start','end'] } }, required: ['range'] },
                { type: 'object', properties: { anchors: { type: 'object', properties: { before: { type: 'string' }, after: { type: 'string' }, occurrence: { type: 'integer', minimum: 1 } } } }, required: ['anchors'] },
                { type: 'object', properties: { regex: { type: 'object', properties: { pattern: { type: 'string' }, flags: { type: 'string' }, occurrence: { type: 'integer', minimum: 1 } }, required: ['pattern'] } }, required: ['regex'] },
                { type: 'object', properties: { structuralMatch: { type: 'object', properties: { file: { type: 'string' }, start: { type: 'object', properties: { line: { type: 'integer' }, column: { type: 'integer' } }, required: ['line','column'] }, end: { type: 'object', properties: { line: { type: 'integer' }, column: { type: 'integer' } }, required: ['line','column'] } }, required: ['file','start','end'] } }, required: ['structuralMatch'] }
              ]
            },
            action: {
              oneOf: [
                { type: 'object', properties: { 'text.replace': { type: 'object', properties: { newText: { type: 'string' } }, required: ['newText'] } }, required: ['text.replace'] },
                { type: 'object', properties: { 'text.insert': { type: 'object', properties: { position: { enum: ['before','after','start','end'] }, text: { type: 'string' } }, required: ['position','text'] } }, required: ['text.insert'] },
                { type: 'object', properties: { 'text.delete': { type: 'object' } }, required: ['text.delete'] },
                { type: 'object', properties: { 'text.wrap': { type: 'object', properties: { prefix: { type: 'string' }, suffix: { type: 'string' } }, required: ['prefix','suffix'] } }, required: ['text.wrap'] }
              ]
            }
          },
          required: ['path','selector','action'],
          additionalProperties: false
        }
      },
      dryRun: { type: 'boolean', default: false },
      rangesOnly: { type: 'boolean', default: false },
      verify: { type: 'boolean', default: true },
      tsconfigPath: { type: 'string' }
    },
    additionalProperties: false,
  },
  run: async (args: { textEdits?: any[]; astRewrites?: any[]; advancedTextEdits?: any[]; dryRun?: boolean; rangesOnly?: boolean; verify?: boolean; tsconfigPath?: string }) => {
    const dryRun = !!args.dryRun
    const rangesOnly = !!args.rangesOnly
    const verify = args.verify !== false
    const textEdits = Array.isArray(args.textEdits) ? args.textEdits : []
    const astOps = Array.isArray(args.astRewrites) ? args.astRewrites : []
    const advOps = Array.isArray(args.advancedTextEdits) ? args.advancedTextEdits : []
    try {
      const resText = textEdits.length ? await applyFileEditsInternal(textEdits, { dryRun, verify: false }) : { applied: 0, results: [] as any[] }
      const astResults: any[] = []
      let astApplied = 0
      for (const op of astOps) {
        const r = await astGrepRewrite({
          pattern: op.pattern,
          rewrite: op.rewrite,
          languages: (op.languages && op.languages.length) ? op.languages : 'auto',
          includeGlobs: op.includeGlobs,
          excludeGlobs: op.excludeGlobs,
          perFileLimit: op.perFileLimit,
          totalLimit: op.totalLimit,
          maxFileBytes: op.maxFileBytes,
          concurrency: op.concurrency,
          dryRun,
          rangesOnly,
        })
        astResults.push(r)
        astApplied += r.changes.reduce((acc, c) => acc + (c.applied ? c.count : 0), 0)
      }

      // Advanced text edits
      const advResults: any[] = []
      let advApplied = 0
      const byFile: Record<string, any[]> = {}
      for (const ed of advOps) {
        if (!byFile[ed.path]) byFile[ed.path] = []
        byFile[ed.path].push(ed)
      }
      const crypto = await import('node:crypto')
      for (const [p, ops] of Object.entries(byFile)) {
        const abs = resolveWithinWorkspace(p)
        let content = ''
        try { content = await fs.readFile(abs, 'utf-8') } catch { advResults.push({ path: p, changed: false, message: 'read-failed' }); continue }
        const origChecksum = crypto.createHash('sha1').update(content, 'utf8').digest('hex')
        let changed = false
        const lines = content.split(/\r?\n/)
        const idx: number[] = [0]; for (let i=0;i<lines.length;i++) idx.push(idx[i] + lines[i].length + 1)
        function off(line1: number, col1: number) { const l0 = Math.max(0, Math.min(idx.length-2, (line1|0)-1)); return idx[l0] + Math.max(0, (col1|0)-1) }

        for (const op of ops) {
          // Resolve selection
          let s = 0, e = 0
          if (op.selector?.range) {
            s = off(op.selector.range.start.line, op.selector.range.start.column)
            e = off(op.selector.range.end.line, op.selector.range.end.column)
          } else if (op.selector?.anchors) {
            const before = op.selector.anchors.before || ''
            const after = op.selector.anchors.after || ''
            const occ = Math.max(1, op.selector.anchors.occurrence || 1)
            if (before) {
              let pos = -1, from = 0
              for (let i=0;i<occ;i++) { pos = content.indexOf(before, from); if (pos === -1) break; from = pos + before.length }
              if (pos !== -1) s = pos + before.length
            }
            if (after) {
              const pos = content.indexOf(after, s)
              if (pos !== -1) e = pos
            } else { e = s }
          } else if (op.selector?.regex) {
            const re = new RegExp(op.selector.regex.pattern, op.selector.regex.flags || 'g')
            const occ = Math.max(1, op.selector.regex.occurrence || 1)
            let m: RegExpExecArray | null = null
            let count = 0
            while ((m = re.exec(content))) { count++; if (count === occ) { s = m.index; e = m.index + m[0].length; break } if (!re.global) break }
          } else if (op.selector?.structuralMatch) {
            s = off(op.selector.structuralMatch.start.line, op.selector.structuralMatch.start.column)
            e = off(op.selector.structuralMatch.end.line, op.selector.structuralMatch.end.column)
          } else {
            advResults.push({ path: p, changed: false, message: 'bad-selector' }); continue
          }

          const selected = content.slice(s, e)
          // Guards
          if (op.guard?.expectedBefore && !selected.includes(op.guard.expectedBefore)) { advResults.push({ path: p, changed: false, message: 'guard-mismatch' }); continue }
          if (op.guard?.checksum && op.guard.checksum !== origChecksum) { advResults.push({ path: p, changed: false, message: 'stale-file' }); continue }

          // Action
          let next = content
          if (op.action['text.replace']) {
            next = content.slice(0, s) + op.action['text.replace'].newText + content.slice(e)
          } else if (op.action['text.insert']) {
            const pos = op.action['text.insert'].position
            const ins = op.action['text.insert'].text
            if (pos === 'before') next = content.slice(0, s) + ins + content.slice(s)
            else if (pos === 'after') next = content.slice(0, e) + ins + content.slice(e)
            else if (pos === 'start') next = ins + content
            else next = content + ins
          } else if (op.action['text.delete']) {
            next = content.slice(0, s) + content.slice(e)
          } else if (op.action['text.wrap']) {
            const pre = op.action['text.wrap'].prefix, suf = op.action['text.wrap'].suffix
            next = content.slice(0, s) + pre + selected + suf + content.slice(e)
          } else {
            advResults.push({ path: p, changed: false, message: 'bad-action' }); continue
          }

          const start = (()=>{ // recalc start/end lines
            const lines2 = content.slice(0, s).split(/\r?\n/); return { line: lines2.length, column: lines2[lines2.length-1].length + 1 }
          })()
          const end = (()=>{ const lines2 = content.slice(0, e).split(/\r?\n/); return { line: lines2.length, column: lines2[lines2.length-1].length + 1 } })()
          advResults.push({ path: p, changed: !dryRun && !rangesOnly && next !== content, ranges: [{ startLine: start.line, startCol: start.column, endLine: end.line, endCol: end.column }] })
          if (!dryRun && !rangesOnly && next !== content) { content = next; changed = true }
        }

        if (!dryRun && !rangesOnly && changed) {
          await atomicWrite(abs, content)
          advApplied += 1
        }
      }

      let verification: any = undefined
      if (verify && !dryRun && !rangesOnly) {
        try { verification = tsVerify(args.tsconfigPath) } catch {}
      }
      return {
        ok: true,
        applied: (resText.applied || 0) + astApplied + advApplied,
        results: [
          ...(resText.results || []),
          ...astResults.flatMap((r) => r.changes.map((c: any) => ({ path: c.filePath, changed: !!c.applied, ranges: c.ranges, count: c.count }))),
          ...advResults
        ],
        dryRun,
        rangesOnly,
        verification,
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  },
}

