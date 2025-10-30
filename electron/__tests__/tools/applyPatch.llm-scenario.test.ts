import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { applyPatchTool } from '../../tools/edits/applyPatch'

/**
 * This test reproduces the exact scenario the user's LLM was experiencing:
 * - LLM wraps patch in *** Begin Patch / *** End Patch markers
 * - The old code was stripping the first line (diff --git header)
 * - This caused "No file diffs found in patch" error
 * 
 * After the fix, this should work correctly.
 */
describe('applyPatch - LLM scenario reproduction', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apply-patch-llm-'))
    process.env.HIFIDE_WORKSPACE_ROOT = tmpDir
  })

  afterAll(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {}
  })

  test('LLM scenario: Create new file with *** Begin Patch wrapper', async () => {
    // This is exactly what the user's LLM was trying
    const patch = `*** Begin Patch
diff --git a/tooling/apply-patch-demo.txt b/tooling/apply-patch-demo.txt
new file mode 100644
--- /dev/null
+++ b/tooling/apply-patch-demo.txt
@@ -0,0 +1,3 @@
+This is a demo file.
+Created by the LLM.
+Using apply_patch tool.
*** End Patch`

    const result = await applyPatchTool.run({ patch, dryRun: true })
    
    // Should succeed now (was failing before the fix)
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)
    expect(result.dryRun).toBe(true)
    expect(result.fileEditsPreview).toBeDefined()
    expect(result.fileEditsPreview.length).toBe(1)
    expect(result.fileEditsPreview[0].path).toBe('tooling/apply-patch-demo.txt')
    expect(result.fileEditsPreview[0].after).toContain('This is a demo file')
  })

  test('LLM scenario: Modify existing file with *** Begin Patch wrapper', async () => {
    // Create a file first
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'src', 'example.ts'),
      'function hello() {\n  console.log("old")\n}\n',
      'utf-8'
    )

    const patch = `*** Begin Patch
diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,3 @@
 function hello() {
-  console.log("old")
+  console.log("new")
 }
*** End Patch`

    const result = await applyPatchTool.run({ patch, dryRun: false })
    
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)
    
    const content = await fs.readFile(path.join(tmpDir, 'src', 'example.ts'), 'utf-8')
    expect(content).toBe('function hello() {\n  console.log("new")\n}\n')
  })

  test('LLM scenario: Delete file with *** Begin Patch wrapper', async () => {
    // Create a file to delete
    await fs.writeFile(
      path.join(tmpDir, 'to-delete.txt'),
      'This file will be deleted\n',
      'utf-8'
    )

    const patch = `*** Begin Patch
diff --git a/to-delete.txt b/to-delete.txt
deleted file mode 100644
--- a/to-delete.txt
+++ /dev/null
@@ -1 +0,0 @@
-This file will be deleted
*** End Patch`

    const result = await applyPatchTool.run({ patch, dryRun: true })
    
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)
    expect(result.fileEditsPreview[0].after).toBe('')
  })

  test('LLM scenario: Multiple files with *** Begin Patch wrapper', async () => {
    await fs.writeFile(path.join(tmpDir, 'file1.ts'), 'const a = 1\n', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'file2.ts'), 'const b = 2\n', 'utf-8')

    const patch = `*** Begin Patch
diff --git a/file1.ts b/file1.ts
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
*** End Patch`

    const result = await applyPatchTool.run({ patch, dryRun: false })
    
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(2)
    
    const content1 = await fs.readFile(path.join(tmpDir, 'file1.ts'), 'utf-8')
    const content2 = await fs.readFile(path.join(tmpDir, 'file2.ts'), 'utf-8')
    expect(content1).toBe('const a = 10\n')
    expect(content2).toBe('const b = 20\n')
  })

  test('LLM scenario: Code fence wrapper (```diff)', async () => {
    await fs.writeFile(path.join(tmpDir, 'fenced.ts'), 'const x = 1\n', 'utf-8')

    const patch = `\`\`\`diff
diff --git a/fenced.ts b/fenced.ts
--- a/fenced.ts
+++ b/fenced.ts
@@ -1 +1 @@
-const x = 1
+const x = 2
\`\`\``

    const result = await applyPatchTool.run({ patch, dryRun: false })
    
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)
    
    const content = await fs.readFile(path.join(tmpDir, 'fenced.ts'), 'utf-8')
    expect(content).toBe('const x = 2\n')
  })

  test('LLM scenario: Raw patch without wrapper', async () => {
    await fs.writeFile(path.join(tmpDir, 'raw.ts'), 'const y = 1\n', 'utf-8')

    const patch = `diff --git a/raw.ts b/raw.ts
--- a/raw.ts
+++ b/raw.ts
@@ -1 +1 @@
-const y = 1
+const y = 2
`

    const result = await applyPatchTool.run({ patch, dryRun: false })
    
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)
    
    const content = await fs.readFile(path.join(tmpDir, 'raw.ts'), 'utf-8')
    expect(content).toBe('const y = 2\n')
  })
})

