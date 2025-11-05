import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { applyPatchTool } from '../../tools/edits/applyPatch'

describe('applyPatch tool', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apply-patch-'))
    process.env.HIFIDE_WORKSPACE_ROOT = tmpDir
  })

  afterAll(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {}
  })

  test('should modify existing file with simple patch', async () => {
    // Create test file
    const testFile = path.join(tmpDir, 'test.ts')
    await fs.writeFile(testFile, 'function hello() {\n  console.log("old")\n}\n', 'utf-8')

    // Apply patch
    const patch = `diff --git a/test.ts b/test.ts
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,3 @@
 function hello() {
-  console.log("old")
+  console.log("new")
 }
`

    const result = await applyPatchTool.run({ patch, dryRun: false })

    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)

    const content = await fs.readFile(testFile, 'utf-8')
    expect(content).toBe('function hello() {\n  console.log("new")\n}\n')
  })

  test('should create new file', async () => {
    const patch = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,3 @@
+export function test() {
+  return 42
+}
`

    const result = await applyPatchTool.run({ patch, dryRun: false })

    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)

    const content = await fs.readFile(path.join(tmpDir, 'new.ts'), 'utf-8')
    expect(content).toBe('export function test() {\n  return 42\n}\n')
  })

  test('should work with dryRun', async () => {
    const testFile = path.join(tmpDir, 'dryrun.ts')
    await fs.writeFile(testFile, 'const x = 1\n', 'utf-8')

    const patch = `diff --git a/dryrun.ts b/dryrun.ts
--- a/dryrun.ts
+++ b/dryrun.ts
@@ -1 +1 @@
-const x = 1
+const x = 2
`

    const result = await applyPatchTool.run({ patch, dryRun: true })

    expect(result.ok).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(result.fileEditsPreview).toBeDefined()
    expect(result.fileEditsPreview.length).toBe(1)
    expect(result.fileEditsPreview[0].after).toContain('const x = 2')

    // File should not be modified
    const content = await fs.readFile(testFile, 'utf-8')
    expect(content).toBe('const x = 1\n')
  })

  test('should handle multiple files in one patch', async () => {
    await fs.writeFile(path.join(tmpDir, 'file1.ts'), 'const a = 1\n', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'file2.ts'), 'const b = 2\n', 'utf-8')

    const patch = `diff --git a/file1.ts b/file1.ts
--- a/file1.ts
+++ b/file1.ts
@@ -1 +1 @@
-const a = 1
+const a = 10
diff --git a/file2.ts b/file2.ts
--- a/file2.ts
+++ b/file2.ts
@@ -1 +1 @@
-const b = 2
+const b = 20
`

    const result = await applyPatchTool.run({ patch, dryRun: false })

    expect(result.ok).toBe(true)
    expect(result.applied).toBe(2)

    const content1 = await fs.readFile(path.join(tmpDir, 'file1.ts'), 'utf-8')
    const content2 = await fs.readFile(path.join(tmpDir, 'file2.ts'), 'utf-8')
    expect(content1).toBe('const a = 10\n')
    expect(content2).toBe('const b = 20\n')
  })

  test('should accept minimal patch without diff header', async () => {
    const testFile = path.join(tmpDir, 'test.ts')
    await fs.writeFile(testFile, 'old\n', 'utf-8')

    const patch = `--- a/test.ts
+++ b/test.ts
@@ -1 +1 @@
-old
+new
`

    const result = await applyPatchTool.run({ patch, dryRun: false })

    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)

    const content = await fs.readFile(testFile, 'utf-8')
    expect(content).toBe('new\n')
  })

  test('should handle context mismatch gracefully', async () => {
    await fs.writeFile(path.join(tmpDir, 'mismatch.ts'), 'const x = 1\n', 'utf-8')

    const patch = `diff --git a/mismatch.ts b/mismatch.ts
--- a/mismatch.ts
+++ b/mismatch.ts
@@ -1 +1 @@
-const x = 999
+const x = 2
`

    const result = await applyPatchTool.run({ patch, dryRun: true })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('mismatch')
  })

  test('should handle *** Begin Patch wrapper', async () => {
    await fs.writeFile(path.join(tmpDir, 'wrapped.ts'), 'const x = 1\n', 'utf-8')

    const patch = `*** Begin Patch
diff --git a/wrapped.ts b/wrapped.ts
--- a/wrapped.ts
+++ b/wrapped.ts
@@ -1 +1 @@
-const x = 1
+const x = 2
*** End Patch`

    const result = await applyPatchTool.run({ patch, dryRun: false })

    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)

    const content = await fs.readFile(path.join(tmpDir, 'wrapped.ts'), 'utf-8')
    expect(content).toBe('const x = 2\n')
  })

  test('should handle code fence wrapper', async () => {
    await fs.writeFile(path.join(tmpDir, 'fenced.ts'), 'const y = 1\n', 'utf-8')

    const patch = `\`\`\`diff
diff --git a/fenced.ts b/fenced.ts
--- a/fenced.ts
+++ b/fenced.ts
@@ -1 +1 @@
-const y = 1
+const y = 2
\`\`\``

    const result = await applyPatchTool.run({ patch, dryRun: false })

    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)

    const content = await fs.readFile(path.join(tmpDir, 'fenced.ts'), 'utf-8')
    expect(content).toBe('const y = 2\n')
  })

  test('should accept udiff-simple with path inside fence (Gemini variant)', async () => {
    const testFile = path.join(tmpDir, 'simp.ts')
    await fs.writeFile(testFile, 'x\n', 'utf-8')

    const patch = `\`\`\`diff filename=simp.ts
simp.ts
@@ -1 +1 @@
-x
+y
\`\`\``

    const result = await applyPatchTool.run({ patch, dryRun: false })
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)

    const content = await fs.readFile(testFile, 'utf-8')
    expect(content).toBe('y\n')
  })
})
