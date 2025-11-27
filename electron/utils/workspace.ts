/**
 * Workspace resolution utilities
 * 
 * This module provides a single source of truth for resolving workspace roots.
 * It eliminates the duplication of workspace resolution logic across the codebase.
 */

import path from 'node:path'

/**
 * Resolve workspace root with consistent fallback order
 * 
 * Priority:
 * 1. Explicit hint parameter (e.g., meta.workspaceId from flow execution)
 * 2. Main store workspaceRoot (global, single-window)
 * 3. process.cwd() (fallback for tests/early boot)
 * 
 * @param hint - Optional workspace ID (absolute path) to use
 * @returns Absolute path to workspace root
 */
export function resolveWorkspaceRoot(hint?: string): string {
  if (hint) {
    return path.resolve(hint)
  }

  try {
    // Dynamic import to avoid circular dependencies
    const { ServiceRegistry } = require('../services/base/ServiceRegistry.js')
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const root = workspaceService?.getWorkspaceRoot()
    if (root) {
      return path.resolve(root)
    }
  } catch (error) {
    // Store not available (tests, early boot)
  }

  return path.resolve(process.cwd())
}

/**
 * Async version of resolveWorkspaceRoot for consistency with existing patterns
 * 
 * @param hint - Optional workspace ID (absolute path) to use
 * @returns Absolute path to workspace root
 */
export async function resolveWorkspaceRootAsync(hint?: string): Promise<string> {
  if (hint) {
    return path.resolve(hint)
  }

  try {
    const { ServiceRegistry } = await import('../services/base/ServiceRegistry.js')
    const workspaceService = ServiceRegistry.get<any>('workspace')
    const root = workspaceService?.getWorkspaceRoot()
    if (root) {
      return path.resolve(root)
    }
  } catch (error) {
    // Store not available (tests, early boot)
  }

  return path.resolve(process.cwd())
}

/**
 * Resolve a path within the workspace, preventing directory traversal
 * 
 * @param relativePath - Path to resolve (relative or absolute)
 * @param workspaceHint - Optional workspace ID to use
 * @returns Absolute path within workspace
 * @throws Error if path is outside workspace
 */
export function resolveWithinWorkspace(relativePath: string, workspaceHint?: string): string {
  const root = resolveWorkspaceRoot(workspaceHint)
  const abs = path.isAbsolute(relativePath) ? relativePath : path.join(root, relativePath)
  const norm = path.resolve(abs)
  const guard = root.endsWith(path.sep) ? root : root + path.sep
  
  if (!(norm + path.sep).startsWith(guard)) {
    throw new Error('Path outside workspace')
  }
  
  return norm
}

