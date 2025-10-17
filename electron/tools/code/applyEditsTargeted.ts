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
        description: 'Simple text edits (replace, insert, or replace range)',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['replaceOnce', 'insertAfterLine', 'replaceRange'], description: 'Type of text edit' },
            path: { type: 'string', description: 'File path relative to workspace' },
            // For replaceOnce
            oldText: { type: 'string', description: 'Text to find and replace (for replaceOnce)' },
            newText: { type: 'string', description: 'Replacement text (for replaceOnce)' },
            // For insertAfterLine
            line: { type: 'integer', description: 'Line number to insert after (for insertAfterLine)' },
            text: { type: 'string', description: 'Text to insert (for insertAfterLine)' },
            // For replaceRange
            start: { type: 'integer', description: 'Start character offset (for replaceRange)' },
            end: { type: 'integer', description: 'End character offset (for replaceRange)' },
          },
          required: ['type', 'path']
        },
      },
      astRewrites: {
        type: 'array',
        description: 'AST-based rewrites using ast-grep patterns',
        items: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'ast-grep pattern to match' },
            rewrite: { type: 'string', description: 'ast-grep rewrite template' },
            languages: { type: 'array', items: { type: 'string' }, description: 'Languages to target (e.g., ["typescript", "javascript"])' },
            includeGlobs: { type: 'array', items: { type: 'string' }, description: 'File patterns to include' },
            excludeGlobs: { type: 'array', items: { type: 'string' }, description: 'File patterns to exclude' },
            perFileLimit: { type: 'integer', minimum: 1, maximum: 1000, description: 'Max matches per file' },
            totalLimit: { type: 'integer', minimum: 1, maximum: 100000, description: 'Max total matches' },
            maxFileBytes: { type: 'integer', minimum: 1, description: 'Max file size to process' },
            concurrency: { type: 'integer', minimum: 1, maximum: 32, description: 'Parallel processing limit' },
          },
          required: ['pattern', 'rewrite']
        },
      },
      advancedTextEdits: {
        type: 'array',
        description: 'Advanced text edits with flexible selectors and actions',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace' },
            // Guard properties (optional)
            guardExpectedBefore: { type: 'string', description: 'Text that must be present in selection before edit' },
            guardChecksum: { type: 'string', description: 'SHA1 checksum of file before edit' },
            // Selector type
            selectorType: { type: 'string', enum: ['range', 'anchors', 'regex', 'structural'], description: 'How to select the text to edit' },
            // Range selector properties
            rangeStartLine: { type: 'integer', description: 'Start line (1-based) for range selector' },
            rangeStartColumn: { type: 'integer', description: 'Start column (1-based) for range selector' },
            rangeEndLine: { type: 'integer', description: 'End line (1-based) for range selector' },
            rangeEndColumn: { type: 'integer', description: 'End column (1-based) for range selector' },
            // Anchors selector properties
            anchorBefore: { type: 'string', description: 'Text before selection for anchors selector' },
            anchorAfter: { type: 'string', description: 'Text after selection for anchors selector' },
            anchorOccurrence: { type: 'integer', minimum: 1, description: 'Which occurrence to match (default: 1)' },
            // Regex selector properties
            regexPattern: { type: 'string', description: 'Regex pattern for regex selector' },
            regexFlags: { type: 'string', description: 'Regex flags (e.g., "g", "i")' },
            regexOccurrence: { type: 'integer', minimum: 1, description: 'Which match to select (default: 1)' },
            // Structural selector properties
            structuralFile: { type: 'string', description: 'File path for structural match' },
            structuralStartLine: { type: 'integer', description: 'Start line for structural match' },
            structuralStartColumn: { type: 'integer', description: 'Start column for structural match' },
            structuralEndLine: { type: 'integer', description: 'End line for structural match' },
            structuralEndColumn: { type: 'integer', description: 'End column for structural match' },
            // Action type
            actionType: { type: 'string', enum: ['replace', 'insert', 'delete', 'wrap'], description: 'What to do with selected text' },
            // Replace action properties
            replaceNewText: { type: 'string', description: 'New text for replace action' },
            // Insert action properties
            insertPosition: { type: 'string', enum: ['before', 'after', 'start', 'end'], description: 'Where to insert for insert action' },
            insertText: { type: 'string', description: 'Text to insert for insert action' },
            // Wrap action properties
            wrapPrefix: { type: 'string', description: 'Prefix for wrap action' },
            wrapSuffix: { type: 'string', description: 'Suffix for wrap action' },
          },
          required: ['path', 'selectorType', 'actionType']
        }
      },
      dryRun: { type: 'boolean', default: false, description: 'Preview changes without applying' },
      rangesOnly: { type: 'boolean', default: false, description: 'Return only affected ranges' },
      verify: { type: 'boolean', default: true, description: 'Run TypeScript verification after edits' },
      tsconfigPath: { type: 'string', description: 'Path to tsconfig.json for verification' }
    },
  },
  run: async (args: { textEdits?: any[]; astRewrites?: any[]; advancedTextEdits?: any[]; dryRun?: boolean; rangesOnly?: boolean; verify?: boolean; tsconfigPath?: string }) => {
    const dryRun = !!args.dryRun
    const rangesOnly = !!args.rangesOnly
    const verify = args.verify !== false
    const textEdits = Array.isArray(args.textEdits) ? args.textEdits : []
    const astOps = Array.isArray(args.astRewrites) ? args.astRewrites : []
    const advOpsFlat = Array.isArray(args.advancedTextEdits) ? args.advancedTextEdits : []

    // Convert flattened advancedTextEdits back to nested format for internal processing
    const advOps = advOpsFlat.map((flat: any) => {
      const op: any = { path: flat.path }

      // Guard
      if (flat.guardExpectedBefore || flat.guardChecksum) {
        op.guard = {}
        if (flat.guardExpectedBefore) op.guard.expectedBefore = flat.guardExpectedBefore
        if (flat.guardChecksum) op.guard.checksum = flat.guardChecksum
      }

      // Selector
      op.selector = {}
      if (flat.selectorType === 'range') {
        op.selector.range = {
          start: { line: flat.rangeStartLine, column: flat.rangeStartColumn },
          end: { line: flat.rangeEndLine, column: flat.rangeEndColumn }
        }
      } else if (flat.selectorType === 'anchors') {
        op.selector.anchors = {
          before: flat.anchorBefore,
          after: flat.anchorAfter,
          occurrence: flat.anchorOccurrence
        }
      } else if (flat.selectorType === 'regex') {
        op.selector.regex = {
          pattern: flat.regexPattern,
          flags: flat.regexFlags,
          occurrence: flat.regexOccurrence
        }
      } else if (flat.selectorType === 'structural') {
        op.selector.structuralMatch = {
          file: flat.structuralFile,
          start: { line: flat.structuralStartLine, column: flat.structuralStartColumn },
          end: { line: flat.structuralEndLine, column: flat.structuralEndColumn }
        }
      }

      // Action
      op.action = {}
      if (flat.actionType === 'replace') {
        op.action['text.replace'] = { newText: flat.replaceNewText }
      } else if (flat.actionType === 'insert') {
        op.action['text.insert'] = { position: flat.insertPosition, text: flat.insertText }
      } else if (flat.actionType === 'delete') {
        op.action['text.delete'] = {}
      } else if (flat.actionType === 'wrap') {
        op.action['text.wrap'] = { prefix: flat.wrapPrefix, suffix: flat.wrapSuffix }
      }

      return op
    })

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

