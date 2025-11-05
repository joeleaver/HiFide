/**
 * readFile node
 *
 * Category: Input
 * Reads a file from the current workspace and outputs its contents as Data Out.
 * No inputs. Data-only output.
 *
 * Props:
 * - filePath: string (workspace-relative recommended)
 * - tokenEstimateTokens?: number (UI hint; updated on pick and on execute)
 */

import fs from 'node:fs/promises'
import { resolveWithinWorkspace } from '../../../tools/utils'
import type { NodeFunction, NodeExecutionPolicy } from '../types'

export const metadata = {
  executionPolicy: 'any' as NodeExecutionPolicy,
  description: 'Read a file from the workspace and output its contents (Data Out).'
}

export const readFileNode: NodeFunction = async (flow, _context, _dataIn, _inputs, config) => {
  const filePath = (config?.filePath || '').trim()
  if (!filePath) {
    flow.log.warn('readFile: missing filePath')
    return {
      context: null,
      data: '',
      status: 'blocked',
      metadata: { error: 'No file selected' }
    }
  }

  let absPath: string
  try {
    absPath = resolveWithinWorkspace(filePath)
  } catch (err) {
    const msg = `readFile: path outside workspace or invalid: ${String(err)}`
    flow.log.error(msg)
    return {
      context: null,
      data: '',
      status: 'error',
      metadata: { error: msg }
    }
  }

  try {
    const started = Date.now()
    const content = await fs.readFile(absPath, 'utf-8')
    const durationMs = Date.now() - started

    // Simple token estimate (≈4 chars/token)
    const tokenEstimateTokens = Math.ceil((content?.length || 0) / 4)

    // Update node config in main store so UI can show estimate immediately
    try {
      flow.store.fePatchNodeConfig({ id: flow.nodeId, patch: { tokenEstimateTokens } })
    } catch {}

    flow.log.info('readFile: read content', {
      filePath,
      bytes: content.length,
      tokenEstimateTokens,
    })

    return {
      context: null,
      data: content,
      status: 'success',
      metadata: { tokenEstimateTokens, durationMs }
    }
  } catch (err) {
    const msg = `readFile: failed to read file: ${String(err)}`
    flow.log.error(msg)
    return {
      context: null,
      data: '',
      status: 'error',
      metadata: { error: msg }
    }
  }
}

