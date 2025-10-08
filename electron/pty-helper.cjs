#!/usr/bin/env node
// Simple PTY helper that runs under Node runtime to avoid Electron ABI prebuilds
// Communicates via NDJSON over stdin/stdout

const readline = require('node:readline')
const { spawn: spawnChild } = require('node:child_process')
let pty
try {
  pty = require('@homebridge/node-pty-prebuilt-multiarch')
} catch (e) {
  console.error(JSON.stringify({ type: 'fatal', error: e && e.message ? e.message : String(e) }))
  process.exit(1)
}

const sessions = new Map()

function send(obj) {
  try { process.stdout.write(JSON.stringify(obj) + "\n") } catch {}
}

function onCreate(msg) {
  const isWin = process.platform === 'win32'
  const shell = msg.shell || (isWin ? (process.env.COMSPEC || 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe') : (process.env.SHELL || '/bin/bash'))
  const cols = msg.cols || 80
  const rows = msg.rows || 24
  const env = { ...process.env, ...(msg.env || {}) }
  const cwd = msg.cwd || process.cwd()
  const p = pty.spawn(shell, [], { name: 'xterm-color', cols, rows, cwd, env })
  const sessionId = msg.sessionId || Math.random().toString(36).slice(2, 10)
  sessions.set(sessionId, p)
  p.onData((data) => send({ type: 'data', sessionId, data }))
  p.onExit(({ exitCode }) => {
    send({ type: 'exit', sessionId, exitCode })
    sessions.delete(sessionId)
  })
  send({ type: 'created', reqId: msg.reqId, sessionId })
}

function onWrite(msg) {
  const p = sessions.get(msg.sessionId)
  if (p) {
    try { p.write(msg.data) } catch {}
  }
}
function onResize(msg) {
  const p = sessions.get(msg.sessionId)
  if (p) {
    try { p.resize(msg.cols, msg.rows) } catch {}
  }
}
function onDispose(msg) {
  const p = sessions.get(msg.sessionId)
  if (p) {
    try { p.kill() } catch {}
    sessions.delete(msg.sessionId)
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  if (!line) return
  let msg
  try { msg = JSON.parse(line) } catch { return }
  switch (msg.type) {
    case 'create': return onCreate(msg)
    case 'write': return onWrite(msg)
    case 'resize': return onResize(msg)
    case 'dispose': return onDispose(msg)
    default: return
  }
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))

