import type { AgentTool } from '../../providers/provider'

export interface ToolPolicyOptions {
  maxWorkspaceSearch?: number
  dedupeReadLines?: boolean
  maxReadLinesPerFile?: number
  dedupeReadFile?: boolean
  maxReadFilePerFile?: number
  forceSearchOnce?: boolean
}

export function wrapToolsWithPolicy(tools: AgentTool[], policy?: ToolPolicyOptions): AgentTool[] {
  const wsSearchSeen = new Map<string, any>()
  const readLinesSeen = new Set<string>()
  const readLinesPerFile = new Map<string, number>()
  const readFileSeen = new Set<string>()
  const readFilePerFile = new Map<string, number>()
  const readLinesCache = new Map<string, string>()
  const readFileCache = new Map<string, string>()

  const parseHandle = (h?: string): { p?: string; s?: number; e?: number } | null => {
    if (!h) return null
    try {
      return JSON.parse(Buffer.from(String(h), 'base64').toString('utf-8'))
    } catch {
      return null
    }
  }

  return (tools || []).map((tool) => {
    if (!tool || !tool.name || typeof tool.run !== 'function') return tool
    const normalizedName = (tool.name || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()

    if (normalizedName === 'workspacesearch') {
      const orig = tool.run.bind(tool)
      const wrapped: AgentTool = {
        ...tool,
        run: async (input: any, meta?: any) => {
          const args = { ...(input || {}) }
          const key = JSON.stringify(args)
          if (wsSearchSeen.has(key)) {
            return wsSearchSeen.get(key)
          }
          const out = await orig(args, meta)
          try {
            wsSearchSeen.set(key, out)
          } catch {}
          return out
        }
      }
      return wrapped
    }

    if (normalizedName === 'fsreadlines') {
      const orig = tool.run.bind(tool)
      const wrapped: AgentTool = {
        ...tool,
        run: async (input: any, meta?: any) => {
          const args = input || {}
          const handle = parseHandle(args.handle)
          const rel = (args.path as string) || (handle && handle.p) || ''
          const signatureKey = JSON.stringify({
            tool: tool.name,
            path: rel,
            handle: !!args.handle,
            mode: args.mode || 'range',
            start: args.startLine,
            end: args.endLine,
            focus: args.focusLine,
            window: args.window,
            before: args.beforeLines,
            after: args.afterLines
          })

          if (typeof policy?.maxReadLinesPerFile === 'number') {
            const count = readLinesPerFile.get(signatureKey) || 0
            if (count >= policy.maxReadLinesPerFile) {
              return 'Error: read_locked: read limit reached for this range'
            }
          }

          if (policy?.dedupeReadLines) {
            const key = JSON.stringify({
              tool: tool.name,
              path: rel,
              handle: !!args.handle,
              mode: args.mode || 'range',
              start: args.startLine,
              end: args.endLine,
              focus: args.focusLine,
              window: args.window,
              before: args.beforeLines,
              after: args.afterLines
            })
            if (readLinesSeen.has(key)) {
              if (readLinesCache.has(key)) {
                return readLinesCache.get(key) as string
              }
              return ''
            }
            readLinesSeen.add(key)
          }

          const out = await orig(args, meta)

          if (typeof policy?.maxReadLinesPerFile === 'number') {
            const count = readLinesPerFile.get(signatureKey) || 0
            readLinesPerFile.set(signatureKey, count + 1)
          }

          try {
            if (typeof out === 'string') {
              const key = JSON.stringify({
                tool: tool.name,
                path: rel,
                handle: !!args.handle,
                mode: args.mode || 'range',
                start: args.startLine,
                end: args.endLine,
                focus: args.focusLine,
                window: args.window,
                before: args.beforeLines,
                after: args.afterLines
              })
              readLinesCache.set(key, out)
            }
          } catch {}

          return out
        }
      }
      return wrapped
    }

    if (normalizedName === 'fsreadfile') {
      const orig = tool.run.bind(tool)
      const wrapped: AgentTool = {
        ...tool,
        run: async (input: any, meta?: any) => {
          const args = input || {}
          const rel = (args.path as string) || ''

          if (typeof policy?.maxReadFilePerFile === 'number' && rel) {
            const count = readFilePerFile.get(rel) || 0
            if (count >= policy.maxReadFilePerFile) {
              return 'Error: read_locked: fsReadFile per-file read limit reached'
            }
          }

          if (policy?.dedupeReadFile) {
            const key = JSON.stringify({ tool: tool.name, path: rel })
            if (readFileSeen.has(key)) {
              if (readFileCache.has(key)) {
                return readFileCache.get(key) as string
              }
              return ''
            }
            readFileSeen.add(key)
          }

          const out = await orig(args, meta)

          if (typeof policy?.maxReadFilePerFile === 'number' && rel) {
            const count = readFilePerFile.get(rel) || 0
            readFilePerFile.set(rel, count + 1)
          }

          try {
            if (typeof out === 'string') {
              const key = JSON.stringify({ tool: tool.name, path: rel })
              readFileCache.set(key, out)
            }
          } catch {}

          return out
        }
      }
      return wrapped
    }

    return tool
  })
}
