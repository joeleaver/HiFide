/**
 * Explorer Service
 * 
 * Manages file explorer tree state and file operations.
 */

import { Service } from './base/Service.js'
import type { ExplorerEntry, OpenedFile } from '../store/types.js'

interface ExplorerState {
  explorerOpenFolders: string[]
  explorerChildrenByDir: Record<string, ExplorerEntry[]>
  openedFile: OpenedFile | null
}

export class ExplorerService extends Service<ExplorerState> {
  constructor() {
    super({
      explorerOpenFolders: [],
      explorerChildrenByDir: {},
      openedFile: null,
    })
  }

  protected onStateChange(): void {
    // Explorer state is transient, no persistence needed
  }

  // Getters
  getOpenFolders(): string[] {
    return [...this.state.explorerOpenFolders]
  }

  getChildrenForDir(dir: string): ExplorerEntry[] | undefined {
    return this.state.explorerChildrenByDir[dir]
  }

  getOpenedFile(): OpenedFile | null {
    return this.state.openedFile
  }

  // Actions
  async loadExplorerDir(dirPath: string): Promise<ExplorerEntry[]> {
    // Placeholder - full implementation would use fs to read directory
    // For now, return empty array
    const children: ExplorerEntry[] = []
    
    this.setState({
      explorerChildrenByDir: {
        ...this.state.explorerChildrenByDir,
        [dirPath]: children,
      },
    })

    return children
  }

  toggleExplorerFolder(dirPath: string): void {
    const isOpen = this.state.explorerOpenFolders.includes(dirPath)
    
    if (isOpen) {
      this.setState({
        explorerOpenFolders: this.state.explorerOpenFolders.filter((p) => p !== dirPath),
      })
    } else {
      this.setState({
        explorerOpenFolders: [...this.state.explorerOpenFolders, dirPath],
      })
    }
  }

  async openFile(filePath: string): Promise<void> {
    // Placeholder - full implementation would read file content and detect language
    this.setState({
      openedFile: {
        path: filePath,
        content: '',
        language: 'plaintext',
      },
    })
  }

  closeFile(): void {
    this.setState({ openedFile: null })
  }
}

