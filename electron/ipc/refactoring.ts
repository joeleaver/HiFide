/**
 * TypeScript refactoring operations IPC handlers
 * 
 * Handles TypeScript-specific refactoring operations using ts-morph
 */

import type { IpcMain } from 'electron'
import {
  renameSymbol as tsRenameSymbol,
  organizeImports as tsOrganizeImports,
  verifyTypecheck as tsVerify,
  addNamedExport as tsAddNamedExport,
  moveFileWithImports as tsMoveFile,
  ensureDefaultExport as tsEnsureDefault,
  addNamedExportFrom as tsAddExportFrom,
  extractFunction as tsExtractFunction,
  suggestParams as tsSuggestParams,
  inlineVariable as tsInlineVar,
  inlineFunction as tsInlineFn,
  convertDefaultToNamed as tsDefaultToNamed,
  convertNamedToDefault as tsNamedToDefault,
} from '../refactors/ts'

/**
 * Register TypeScript refactoring IPC handlers
 */
export function registerRefactoringHandlers(ipcMain: IpcMain): void {
  /**
   * Rename a symbol across the project
   */
  ipcMain.handle('tsrefactor:rename', async (_e, args: { filePath: string; oldName: string; newName: string; verify?: boolean; tsconfigPath?: string }) => {
    try {
      await tsRenameSymbol(args)
      const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
      return { ok: true, verification }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Organize imports in a file
   */
  ipcMain.handle('tsrefactor:organizeImports', async (_e, args: { filePath?: string; verify?: boolean; tsconfigPath?: string }) => {
    try {
      await tsOrganizeImports(args)
      const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
      return { ok: true, verification }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Add a named export to a file
   */
  ipcMain.handle('tsrefactor:addExportNamed', async (_e, args: { filePath: string; exportName: string; code?: string; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
    try {
      const result = await tsAddNamedExport(args)
      const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
      return { ok: true, ...result, verification }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Move a file and update all imports
   */
  ipcMain.handle('tsrefactor:moveFile', async (_e, args: { fromPath: string; toPath: string; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
    try {
      const result = await tsMoveFile(args)
      const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
      return { ok: true, ...result, verification }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Ensure a file has a default export
   */
  ipcMain.handle('tsrefactor:ensureDefaultExport', async (_e, args: { filePath: string; name?: string; code?: string; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
    try {
      const result = await tsEnsureDefault(args)
      const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
      return { ok: true, ...result, verification }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Add a re-export from another file
   */
  ipcMain.handle('tsrefactor:addExportFrom', async (_e, args: { indexFilePath: string; exportName: string; fromFilePath: string; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
    try {
      const result = await tsAddExportFrom(args)
      const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
      return { ok: true, ...result, verification }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Suggest parameters for a function
   */
  ipcMain.handle('tsrefactor:suggestParams', async (_e, args: { filePath: string; start: number; end: number; tsconfigPath?: string }) => {
    try {
      const result = await tsSuggestParams(args)
      return { ok: true, ...result }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Extract code into a new function
   */
  ipcMain.handle('tsrefactor:extractFunction', async (_e, args: { filePath: string; start: number; end: number; newName: string; params?: string[]; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
    try {
      const result = await tsExtractFunction(args)
      const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
      return { ok: true, ...result, verification }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Inline a variable
   */
  ipcMain.handle('tsrefactor:inlineVariable', async (_e, args: { filePath: string; name: string; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
    try {
      const result = await tsInlineVar(args)
      const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
      return { ok: true, ...result, verification }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Inline a function
   */
  ipcMain.handle('tsrefactor:inlineFunction', async (_e, args: { filePath: string; name: string; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
    try {
      const result = await tsInlineFn(args)
      const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
      return { ok: true, ...result, verification }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Convert default export to named export
   */
  ipcMain.handle('tsrefactor:defaultToNamed', async (_e, args: { filePath: string; newName: string; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
    try {
      const result = await tsDefaultToNamed(args)
      const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
      return { ok: true, ...result, verification }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  /**
   * Convert named export to default export
   */
  ipcMain.handle('tsrefactor:namedToDefault', async (_e, args: { filePath: string; name: string; apply?: boolean; verify?: boolean; tsconfigPath?: string }) => {
    try {
      const result = await tsNamedToDefault(args)
      const verification = args.verify ? tsVerify(args.tsconfigPath) : undefined
      return { ok: true, ...result, verification }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })
}

