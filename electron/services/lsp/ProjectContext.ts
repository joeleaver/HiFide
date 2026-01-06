import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { normalizePath } from './Protocol.js'

const require = createRequire(import.meta.url)

export interface LaunchConfig {
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
  initializationOptions?: any
  settings?: any
}

export class ProjectContext {
  constructor(public readonly workspaceRoot: string) {}

  resolveWorkspaceRequire() {
    return createRequire(path.join(this.workspaceRoot, 'package.json'))
  }

  resolvePackageBin(packageName: string, preferredBin?: string): string | null {
    const workspaceRequire = this.resolveWorkspaceRequire()
    const resolve = (id: string) => {
      try {
        return workspaceRequire.resolve(id)
      } catch {
        try {
          return require.resolve(id)
        } catch {
          return null
        }
      }
    }

    const pkgJsonPath = resolve(`${packageName}/package.json`)
    if (!pkgJsonPath) return null

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as {
        bin?: string | Record<string, string>
      }
      
      let binEntry: string | null = null
      if (typeof pkg.bin === 'string') {
        binEntry = pkg.bin
      } else if (pkg.bin && typeof pkg.bin === 'object') {
        const bins = pkg.bin as Record<string, string>
        binEntry = (preferredBin ? bins[preferredBin] : null) ?? bins[packageName] ?? bins.default ?? Object.values(bins)[0]
      }
      
      if (!binEntry) return null
      return path.resolve(path.dirname(pkgJsonPath), binEntry)
    } catch {
      return null
    }
  }

  resolveTsserverPath(): string | null {
    const tsPkgJsonPath = this.resolvePackageJson('typescript')
    if (!tsPkgJsonPath) return null
    
    return normalizePath(path.resolve(path.dirname(tsPkgJsonPath), 'lib', 'tsserver.js'))
  }

  resolvePackageJson(packageName: string): string | null {
    const workspaceRequire = this.resolveWorkspaceRequire()
    try {
      return workspaceRequire.resolve(`${packageName}/package.json`)
    } catch {
      try {
        return require.resolve(`${packageName}/package.json`)
      } catch {
        return null
      }
    }
  }

  getLaunchEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env }
    
    if (process.versions?.electron) {
      env.ELECTRON_RUN_AS_NODE = '1'
    }

    delete env.NODE_OPTIONS

    const workspaceNodeModules = path.join(this.workspaceRoot, 'node_modules')
    const existingNodePath = env.NODE_PATH
    env.NODE_PATH = existingNodePath 
      ? `${workspaceNodeModules}${path.delimiter}${existingNodePath}`
      : workspaceNodeModules

    return env
  }
}
