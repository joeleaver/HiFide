/**
 * Shared file discovery utilities for workspace operations
 * 
 * Provides consistent file discovery with .gitignore filtering across all tools.
 * Single source of truth for exclude patterns and file discovery logic.
 */

import fg from 'fast-glob'
import ignore from 'ignore'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Canonical exclude patterns for workspace file discovery
 * These patterns are excluded by default across all tools
 */
export const DEFAULT_EXCLUDE_PATTERNS = [
  // Build outputs
  'node_modules/**',
  'dist/**',
  'dist-electron/**',
  'release/**',
  'build/**',
  'out/**',
  'coverage/**',
  'target/**',
  
  // Framework-specific
  '.next/**',
  '.turbo/**',
  '.cache/**',
  '.pnpm-store/**',
  'vendor/**',
  
  // Python
  '.venv/**',
  'venv/**',
  '__pycache__/**',
  '*.pyc',
  
  // Version control
  '.git/**',
  
  // IDE
  '.idea/**',
  '.vscode/**',
  
  // HiFide internal
  '.hifide-public/**',
  '.hifide_public/**',
  '.hifide-private/**',
  '.hifide_private/**',
]

/**
 * Options for file discovery
 */
export interface FileDiscoveryOptions {
  /** Working directory (defaults to process.cwd()) */
  cwd?: string
  
  /** Include glob patterns (defaults to ['**\/*']) */
  includeGlobs?: string[]
  
  /** Additional exclude patterns (merged with DEFAULT_EXCLUDE_PATTERNS) */
  excludeGlobs?: string[]
  
  /** Whether to respect .gitignore (defaults to true) */
  respectGitignore?: boolean
  
  /** Whether to include dotfiles (defaults to false) */
  includeDotfiles?: boolean
  
  /** Return absolute paths (defaults to true) */
  absolute?: boolean
}

/**
 * Discover files in the workspace with consistent exclude patterns and .gitignore filtering
 * 
 * @param options - File discovery options
 * @returns Array of file paths (absolute by default)
 * 
 * @example
 * ```typescript
 * // Find all TypeScript files
 * const files = await discoverWorkspaceFiles({
 *   includeGlobs: ['**\/*.ts', '**\/*.tsx'],
 *   excludeGlobs: ['**\/*.test.ts']
 * })
 * ```
 */
export async function discoverWorkspaceFiles(options: FileDiscoveryOptions = {}): Promise<string[]> {
  const {
    cwd = process.cwd(),
    includeGlobs = ['**/*'],
    excludeGlobs = [],
    respectGitignore = true,
    includeDotfiles = false,
    absolute = true,
  } = options

  // Merge exclude patterns
  const exclude = [...DEFAULT_EXCLUDE_PATTERNS, ...excludeGlobs]

  // Discover files using fast-glob
  const files = await fg(includeGlobs, {
    cwd,
    ignore: exclude,
    absolute,
    onlyFiles: true,
    dot: includeDotfiles,
  })

  // Apply .gitignore filtering if requested
  if (respectGitignore && files.length > 0) {
    try {
      const gitignorePath = path.join(cwd, '.gitignore')
      const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8').catch(() => '')
      
      if (gitignoreContent) {
        const ig = ignore().add(gitignoreContent)
        
        // Filter files based on .gitignore
        const filtered = files.filter(filePath => {
          const relativePath = absolute 
            ? path.relative(cwd, filePath).replace(/\\/g, '/')
            : filePath.replace(/\\/g, '/')
          return !ig.ignores(relativePath)
        })
        
        return filtered
      }
    } catch (error) {
      // If .gitignore reading fails, continue without filtering
      // This is a best-effort operation
    }
  }

  return files
}

/**
 * Check if a file should be excluded based on default patterns
 * Useful for quick checks without full file discovery
 * 
 * @param filePath - Path to check (relative to workspace root)
 * @returns true if file should be excluded
 */
export function shouldExcludeFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/')
  
  return DEFAULT_EXCLUDE_PATTERNS.some(pattern => {
    // Convert glob pattern to regex for simple matching
    const regexPattern = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
    
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(normalizedPath)
  })
}

