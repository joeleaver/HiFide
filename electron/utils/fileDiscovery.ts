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

// Use sync fs for binary detection (small reads only)
import fsSync from 'node:fs'

/**
 * Check if a file is binary by reading the first few bytes and looking for null bytes.
 * This is a fast, cross-platform way to detect binary files without relying on file extensions.
 * 
 * @param filePath - Absolute path to the file
 * @param bufferSize - Number of bytes to check (default: 1024)
 * @returns true if the file is binary, false if text
 * 
 * @example
 * ```typescript
 * const isBinary = await isBinaryFile('/path/to/file.exe')
 * if (isBinary) {
 *   console.log('Skipping binary file')
 * }
 * ```
 */
export async function isBinaryFile(filePath: string, bufferSize: number = 1024): Promise<boolean> {
  try {
    // Read first N bytes
    const buffer = Buffer.alloc(bufferSize)
    const fd = await fs.open(filePath, 'r')
    const { bytesRead } = await fd.read(buffer, 0, bufferSize, 0)
    await fd.close()

    // Check for null bytes (characteristic of binary files)
    // Also check for high ratio of non-printable bytes
    // let nullByteCount = 0
    let nonPrintableCount = 0
    
    for (let i = 0; i < bytesRead; i++) {
      const byte = buffer[i]
      
      // Null byte is definitive indicator of binary
      if (byte === 0) {
        return true
      }
      
      // Count non-printable characters (excluding common text whitespace)
      if (byte < 9 || (byte > 13 && byte < 32) || byte > 126) {
        nonPrintableCount++
      }
    }
    
    // If more than 30% of bytes are non-printable, likely binary
    if (bytesRead > 0 && (nonPrintableCount / bytesRead) > 0.3) {
      return true
    }
    
    return false
  } catch (error) {
    // If we can't read the file, conservatively assume it's binary
    return true
  }
}

/**
 * Synchronous version of isBinaryFile for use in synchronous contexts
 * 
 * @param filePath - Absolute path to the file
 * @param bufferSize - Number of bytes to check (default: 1024)
 * @returns true if the file is binary, false if text
 */
export function isBinaryFileSync(filePath: string, bufferSize: number = 1024): boolean {
  try {
    const buffer = Buffer.alloc(bufferSize)
    const fd = fsSync.openSync(filePath, 'r')
    const bytesRead = fsSync.readSync(fd, buffer, 0, bufferSize, 0)
    fsSync.closeSync(fd)

    // Check for null bytes (characteristic of binary files)
    for (let i = 0; i < bytesRead; i++) {
      const byte = buffer[i]
      
      // Null byte is definitive indicator of binary
      if (byte === 0) {
        return true
      }
    }
    
    // Also check for high ratio of non-printable bytes
    let nonPrintableCount = 0
    for (let i = 0; i < bytesRead; i++) {
      const byte = buffer[i]
      
      // Count non-printable characters (excluding common text whitespace)
      if (byte < 9 || (byte > 13 && byte < 32) || byte > 126) {
        nonPrintableCount++
      }
    }
    
    // If more than 30% of bytes are non-printable, likely binary
    if (bytesRead > 0 && (nonPrintableCount / bytesRead) > 0.3) {
      return true
    }
    
    return false
  } catch (error) {
    // If we can't read the file, conservatively assume it's binary
    return true
  }
}

/**
 * Canonical exclude patterns for workspace file discovery
 * These patterns are excluded by default across all tools
 * Note: Binary file detection is now done by content inspection (see isBinaryFile).
 * We keep only the most obvious binary archives as an optimization to avoid opening them.
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
  
  // Common binary archives (kept as optimization to avoid opening)
  '*.zip',
  '*.tar',
  '*.tar.gz',
  '*.tgz',
  '*.rar',
  '*.7z',
  '*.bz2',
  '*.gz',
  '*.xz',
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
  
  /** Whether to exclude binary files by content inspection (defaults to true) */
  excludeBinaryFiles?: boolean
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
    excludeBinaryFiles = true,
  } = options

  // Merge exclude patterns
  const exclude = [...DEFAULT_EXCLUDE_PATTERNS, ...excludeGlobs]

  // Discover files using fast-glob
  let files = await fg(includeGlobs, {
    cwd,
    ignore: exclude,
    absolute,
    onlyFiles: true,
    dot: includeDotfiles,
  })

  // Filter binary files if requested
  if (excludeBinaryFiles && files.length > 0) {
    const textFiles = await Promise.all(
      files.map(async (filePath) => {
        try {
          const isBinary = await isBinaryFile(filePath)
          return isBinary ? null : filePath
        } catch {
          return null
        }
      })
    )
    files = textFiles.filter((filePath): filePath is string => filePath !== null)
  }

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

