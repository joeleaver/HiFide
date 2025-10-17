import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Project, SyntaxKind } from 'ts-morph'

function getTsconfigPath(tsconfigPath?: string) {
  const { useMainStore } = require('../store/index.js')
  const root = useMainStore.getState().workspaceRoot || process.cwd()
  return tsconfigPath || path.join(root, 'tsconfig.json')
}

function makeProject(tsconfigPath?: string) {
  const project = new Project({ tsConfigFilePath: getTsconfigPath(tsconfigPath) })
  return project
}

export async function renameSymbol(args: { filePath: string; oldName: string; newName: string; tsconfigPath?: string }) {
  const { filePath, oldName, newName, tsconfigPath } = args
  const project = makeProject(tsconfigPath)
  const sf = project.getSourceFile(filePath)
  if (!sf) throw new Error(`Source file not found: ${filePath}`)
  const ident = sf.getDescendantsOfKind(SyntaxKind.Identifier).find((i) => i.getText() === oldName)
  if (!ident) throw new Error(`Identifier not found in file: ${oldName}`)
  // Rename via identifier node (ts-morph ReferenceFindableNode)
  ;(ident as any).rename?.(newName)
  await project.save()
}

export async function organizeImports(args: { filePath?: string; tsconfigPath?: string }) {
  const { filePath, tsconfigPath } = args
  const project = makeProject(tsconfigPath)
  if (filePath) {
    const sf = project.getSourceFile(filePath)
    if (!sf) throw new Error(`Source file not found: ${filePath}`)
    sf.organizeImports()
  } else {
    for (const sf of project.getSourceFiles()) {
      sf.organizeImports()
    }
  }
  await project.save()
}

export function verifyTypecheck(tsconfigPath?: string): { ok: boolean; exitCode: number; stdout: string; stderr: string } {
  const tsBin = path.join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc')
  const cfg = getTsconfigPath(tsconfigPath)
  const res = spawnSync(process.execPath, [tsBin, '-p', cfg, '--noEmit'], { encoding: 'utf-8' })
  return { ok: res.status === 0, exitCode: res.status ?? -1, stdout: res.stdout || '', stderr: res.stderr || '' }
}


import fs from 'node:fs'

export type Edit = { type: 'modify' | 'move'; path: string; newPath?: string; oldText?: string; newText?: string }

function toPosix(p: string) { return p.replace(/\\/g, '/') }
function withoutExt(p: string) { return p.replace(/\.(ts|tsx|js|jsx)$/, '') }
function computeModuleSpecifier(fromFile: string, toFile: string) {
  const rel = path.relative(path.dirname(fromFile), toFile)
  let spec = toPosix(rel)
  if (!spec.startsWith('.')) spec = './' + spec
  return withoutExt(spec)
}

export async function addNamedExport(args: { filePath: string; exportName: string; code?: string; apply?: boolean; tsconfigPath?: string }): Promise<{ edits: Edit[] }> {
  const { filePath, exportName, code, apply, tsconfigPath } = args
  const project = makeProject(tsconfigPath)
  const sf = project.getSourceFile(filePath)
  if (!sf) throw new Error(`Source file not found: ${filePath}`)
  const original = fs.readFileSync(filePath, 'utf-8')

  const fn = sf.getFunction(exportName)
  const cls = sf.getClass(exportName)
  const vdecl = sf.getVariableDeclaration(exportName)

  if (fn) fn.setIsExported(true)
  else if (cls) cls.setIsExported(true)
  else if (vdecl?.getVariableStatement()) vdecl.getVariableStatement()!.setIsExported(true)
  else if (code) {
    const toInsert = /^\s*export\s/m.test(code) ? code : `export ${code}`
    sf.addStatements(toInsert)
  } else {
    throw new Error(`No declaration named ${exportName} found and no code provided to create it`)
  }

  const after = sf.getFullText()
  const edits: Edit[] = []
  if (original !== after) edits.push({ type: 'modify', path: filePath, oldText: original, newText: after })
  if (apply) await project.save()
  return { edits }
}

export async function moveFileWithImports(args: { fromPath: string; toPath: string; apply?: boolean; tsconfigPath?: string }): Promise<{ edits: Edit[] }> {
  const { fromPath, toPath, apply, tsconfigPath } = args
  const project = makeProject(tsconfigPath)
  const sf = project.getSourceFile(fromPath)
  if (!sf) throw new Error(`Source file not found: ${fromPath}`)

  const originalFrom = fs.existsSync(fromPath) ? fs.readFileSync(fromPath, 'utf-8') : ''

  // Perform move in-memory
  sf.move(toPath)
  const moved = project.getSourceFile(toPath)!

  // Prepare edits array early to track modifications
  const edits: Edit[] = []

  // Update imports that target this file
  for (const f of project.getSourceFiles()) {
    let changed = false
    const before = f.getFullText()
    for (const imp of f.getImportDeclarations()) {
      const target = imp.getModuleSpecifierSourceFile()
      if (target && target.getFilePath() === moved.getFilePath()) {
        const nextSpec = computeModuleSpecifier(f.getFilePath(), moved.getFilePath())
        imp.setModuleSpecifier(nextSpec)
        changed = true
      }
    }
    if (changed) {
      const after = f.getFullText()
      if (before !== after) edits.push({ type: 'modify', path: f.getFilePath(), oldText: before, newText: after })
    }
  }

  const newText = moved.getFullText()
  if (originalFrom !== newText) edits.push({ type: 'modify', path: toPath, oldText: originalFrom, newText })
  if (fromPath !== toPath) edits.push({ type: 'move', path: fromPath, newPath: toPath })

  if (apply) await project.save()
  return { edits }
}

export async function ensureDefaultExport(args: { filePath: string; name?: string; code?: string; apply?: boolean; tsconfigPath?: string }): Promise<{ edits: Edit[] }> {
  const { filePath, name, code, apply, tsconfigPath } = args
  const project = makeProject(tsconfigPath)
  const sf = project.getSourceFile(filePath)
  if (!sf) throw new Error(`Source file not found: ${filePath}`)
  const before = sf.getFullText()

  const hasDefault = sf.getExportAssignments().some(ea => !ea.isExportEquals())
  if (!hasDefault) {
    if (name) {
      // add: export default <name>;
      sf.addExportAssignment({ isExportEquals: false, expression: name })
    } else if (code) {
      // add: export default <code>
      sf.addStatements(`export default ${code}`)
    } else {
      throw new Error('No default export present and neither name nor code provided')
    }
  }

  const after = sf.getFullText()
  const edits: Edit[] = []
  if (before !== after) edits.push({ type: 'modify', path: filePath, oldText: before, newText: after })
  if (apply) await project.save()
  return { edits }
}

export async function addNamedExportFrom(args: { indexFilePath: string; exportName: string; fromFilePath: string; apply?: boolean; tsconfigPath?: string }): Promise<{ edits: Edit[] }> {
  const { indexFilePath, exportName, fromFilePath, apply, tsconfigPath } = args
  const project = makeProject(tsconfigPath)
  const sf = project.getSourceFile(indexFilePath)
  if (!sf) throw new Error(`Source file not found: ${indexFilePath}`)
  const before = sf.getFullText()

  const spec = computeModuleSpecifier(indexFilePath, fromFilePath)
  const existing = sf.getExportDeclarations().find(ed => ed.getModuleSpecifierValue() === spec)
  if (existing) {
    const has = existing.getNamedExports().some(ne => ne.getName() === exportName)
    if (!has) existing.addNamedExport(exportName)
  } else {
    sf.addExportDeclaration({ moduleSpecifier: spec, namedExports: [exportName] })
  }

  const after = sf.getFullText()
  const edits: Edit[] = []
  if (before !== after) edits.push({ type: 'modify', path: indexFilePath, oldText: before, newText: after })
  if (apply) await project.save()
  return { edits }
}


export async function suggestParams(args: { filePath: string; start: number; end: number; tsconfigPath?: string }): Promise<{ params: string[] }> {
  const { filePath, start, end, tsconfigPath } = args
  const project = makeProject(tsconfigPath)
  const sf = project.getSourceFile(filePath)
  if (!sf) throw new Error(`Source file not found: ${filePath}`)
  const range = { pos: start, end }
  const idents = sf.getDescendants().filter(n => {
    const k = n.getKind()
    return k === SyntaxKind.Identifier && n.getPos() >= range.pos && n.getEnd() <= range.end
  })
  const seen = new Set<string>()
  const candidates: string[] = []
  for (const id of idents) {
    const name = id.getText()
    if (seen.has(name)) continue
    // Heuristic: skip keywords/props and declarations inside the range
    const decl = (id as any).getDefinitionNodes?.()?.[0]
    const declaredInside = decl && decl.getPos() >= range.pos && decl.getEnd() <= range.end
    if (!declaredInside && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
      seen.add(name)
      candidates.push(name)
    }
  }
  return { params: candidates }
}

export async function extractFunction(args: { filePath: string; start: number; end: number; newName: string; params?: string[]; apply?: boolean; tsconfigPath?: string }): Promise<{ edits: Edit[] }> {
  const { filePath, start, end, newName, params, apply, tsconfigPath } = args
  const project = makeProject(tsconfigPath)
  const sf = project.getSourceFile(filePath)
  if (!sf) throw new Error(`Source file not found: ${filePath}`)
  const before = sf.getFullText()

  const slice = sf.getFullText().slice(start, end)
  const paramList = (params && params.length ? params : (await suggestParams({ filePath, start, end, tsconfigPath })).params)
  // Insert function at top-level
  sf.addFunction({ name: newName, isExported: false, parameters: paramList.map(p => ({ name: p })), statements: slice })
  // Replace selection with call
  const full = sf.getFullText()
  const call = `${newName}(${paramList.join(', ')})`
  const newText = full.slice(0, start) + call + full.slice(end)
  sf.replaceWithText(newText)

  const after = sf.getFullText()
  const edits: Edit[] = []
  if (before !== after) edits.push({ type: 'modify', path: filePath, oldText: before, newText: after })
  if (apply) await project.save()
  return { edits }
}


export async function inlineVariable(args: { filePath: string; name: string; apply?: boolean; tsconfigPath?: string }): Promise<{ edits: Edit[] }> {
  const { filePath, name, apply, tsconfigPath } = args
  const project = makeProject(tsconfigPath)
  const sf = project.getSourceFile(filePath)
  if (!sf) throw new Error(`Source file not found: ${filePath}`)
  const before = sf.getFullText()
  const v = sf.getVariableDeclaration(name)
  if (!v) throw new Error(`Variable not found: ${name}`)
  const init = v.getInitializer()
  if (!init) throw new Error(`Variable ${name} has no initializer`)
  const initText = init.getText()

  // Replace identifier usages (very basic heuristic: same file, not the decl name)
  const idents = sf.getDescendantsOfKind(SyntaxKind.Identifier).filter(i => i.getText() === name)
  for (const id of idents) {
    const parent = id.getParent()
    const isDecl = parent?.getKind() === SyntaxKind.VariableDeclaration && (parent as any).getNameNode?.() === id
    if (isDecl) continue
    id.replaceWithText(`(${initText})`)
  }
  // Remove original declaration if safe (single declarator)
  const vs = v.getVariableStatement()
  if (vs && vs.getDeclarations().length === 1) vs.remove()

  const after = sf.getFullText()
  const edits: Edit[] = []
  if (before !== after) edits.push({ type: 'modify', path: filePath, oldText: before, newText: after })
  if (apply) await project.save()
  return { edits }
}

export async function inlineFunction(args: { filePath: string; name: string; apply?: boolean; tsconfigPath?: string }): Promise<{ edits: Edit[] }> {
  const { filePath, name, apply, tsconfigPath } = args
  const project = makeProject(tsconfigPath)
  const sf = project.getSourceFile(filePath)
  if (!sf) throw new Error(`Source file not found: ${filePath}`)
  const before = sf.getFullText()

  const fn = sf.getFunction(name)
  if (!fn) throw new Error(`Function not found: ${name}`)
  if (fn.getParameters().length > 0) throw new Error(`inlineFunction MVP supports no-arg functions only`)
  const body = fn.getBody()
  if (!body) throw new Error(`Function ${name} has no body`)
  const ret = body.getDescendantsOfKind(SyntaxKind.ReturnStatement)[0]
  if (!ret) throw new Error(`inlineFunction MVP supports single return expression`)
  const expr = ret.getExpression()?.getText()
  if (!expr) throw new Error(`Return has no expression`)

  // Replace call expressions
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const ident = call.getExpression()
    if (ident && ident.getText() === name && call.getArguments().length === 0) {
      call.replaceWithText(`(${expr})`)
    }
  }
  fn.remove()

  const after = sf.getFullText()
  const edits: Edit[] = []
  if (before !== after) edits.push({ type: 'modify', path: filePath, oldText: before, newText: after })
  if (apply) await project.save()
  return { edits }
}

export async function convertDefaultToNamed(args: { filePath: string; newName: string; apply?: boolean; tsconfigPath?: string }): Promise<{ edits: Edit[] }> {
  const { filePath, newName, apply, tsconfigPath } = args
  const project = makeProject(tsconfigPath)
  const sf = project.getSourceFile(filePath)
  if (!sf) throw new Error(`Source file not found: ${filePath}`)
  const before = sf.getFullText()
  const def = sf.getExportAssignments().find(ea => !ea.isExportEquals())
  if (!def) throw new Error('No default export to convert')
  const expr = def.getExpression().getText()
  def.replaceWithText(`export const ${newName} = ${expr}`)

  const after = sf.getFullText()
  const edits: Edit[] = []
  if (before !== after) edits.push({ type: 'modify', path: filePath, oldText: before, newText: after })
  if (apply) await project.save()
  return { edits }
}

export async function convertNamedToDefault(args: { filePath: string; name: string; apply?: boolean; tsconfigPath?: string }): Promise<{ edits: Edit[] }> {
  const { filePath, name, apply, tsconfigPath } = args
  const project = makeProject(tsconfigPath)
  const sf = project.getSourceFile(filePath)
  if (!sf) throw new Error(`Source file not found: ${filePath}`)
  const before = sf.getFullText()

  // Ensure declaration exists
  const fn = sf.getFunction(name)
  const cls = sf.getClass(name)
  const vdecl = sf.getVariableDeclaration(name)
  if (!fn && !cls && !vdecl) throw new Error(`Symbol not found: ${name}`)

  // Add default export assignment and remove named export specifier if present
  sf.addExportAssignment({ isExportEquals: false, expression: name })
  for (const ed of sf.getExportDeclarations()) {
    ed.getNamedExports().forEach(ne => { if (ne.getName() === name) ne.remove() })
  }

  const after = sf.getFullText()
  const edits: Edit[] = []
  if (before !== after) edits.push({ type: 'modify', path: filePath, oldText: before, newText: after })
  if (apply) await project.save()
  return { edits }
}

