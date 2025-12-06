

const MAX_LINES = 500
const DEFAULT_TIMEOUT_MS = 60000

const sanitizeTerminalOutput = (s: string): string => 
  s.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '') // ANSI strip

const redactOutput = (s: string): { redacted: string; bytesRedacted: number } => 
  ({ redacted: s, bytesRedacted: 0 }) // placeholder; TODO integrate prior logic

// Reusable for future user terminals
export async function spawnPty(command: string, cwd = process.cwd(), timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{
  output: string
  fullLines: number
  lines: number
  exitCode: number | null
  timedOut: boolean
}> {
  // Wrap in shell for builtins/pipes (powershell on Win, sh on Unix)
  let prog: string
  let args: string[]
  if (process.platform === 'win32') {
    prog = 'powershell.exe'
    args = ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command.replace(/"/g, '`"')]
  } else {
    prog = '/bin/sh'
    args = ['-c', command]
  }

  // Dynamic import for ESM compat + types
  const ptyModule = await import('node-pty')
  const spawn = (ptyModule.spawn as any)
  const pty = spawn(prog, args, {
    cwd,
    cols: 120,
    rows: 50,
    env: process.env as Record<string, string> | undefined,
  })!

  let data = ''
  pty.onData((chunk: string) => data += chunk)

  const timeoutP = new Promise<{ timedOut: true; exitCode: null }>((resolve) =>
    setTimeout(() => {
      pty.kill()
      resolve({ timedOut: true, exitCode: null })
    }, timeoutMs)
  )

  const exitP = new Promise<{ timedOut: false; exitCode: number }>((resolve) => {
    // node-pty onExit (not 'exit')
    pty.onExit((e: { exitCode: number, signal?: number }) => resolve({ timedOut: false, exitCode: e.exitCode }))
  })

  const resultRaw = await Promise.race([timeoutP, exitP])
  const timedOut = 'timedOut' in resultRaw && (resultRaw as any).timedOut
  const exitCode = timedOut ? null : (resultRaw as any).exitCode

  const sanitized = sanitizeTerminalOutput(data)
  const { redacted: outputRaw } = redactOutput(sanitized)
  const linesArr = outputRaw.split('\n').filter((l) => l.trim().length > 0)
  const fullLines = linesArr.length
  const lines = Math.min(fullLines, MAX_LINES)
  const preview = linesArr.slice(-lines).join('\n')

  return { output: preview, fullLines, lines, exitCode, timedOut }
}