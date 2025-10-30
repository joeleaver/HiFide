# apply_patch Tool - Complete Guide

## Overview

The `apply_patch` tool applies unified diff patches to workspace files. It uses standard git diff format and has been tested to work correctly.

## Critical Requirements

Every patch **MUST** start with `diff --git` header. Without this, you'll get "No file diffs found in patch" error.

## Wrapper Support

The tool automatically handles common wrappers:
- **Code fences**: ` ```diff ... ``` ` or ` ```patch ... ``` `
- **Begin/End markers**: `*** Begin Patch ... *** End Patch`
- **Heredoc style**: `apply_patch << 'PATCH' ... PATCH`

You can use any of these formats, or send the raw patch directly.

## Format Structure

Each file in the patch requires these components **in order**:

1. `diff --git a/path b/path` - File header (REQUIRED)
2. Optional: `new file mode 100644` (for new files)
3. `--- a/path` or `--- /dev/null` (for new files)
4. `+++ b/path` or `+++ /dev/null` (for deleted files)
5. `@@ -oldStart,oldCount +newStart,newCount @@` - Hunk header
6. Hunk lines with proper prefixes:
   - Space (` `) for context lines (unchanged)
   - Minus (`-`) for deleted lines
   - Plus (`+`) for added lines

## Working Examples

### Example 1: Modify Existing File

```
diff --git a/test.ts b/test.ts
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,3 @@
 function hello() {
-  console.log("old")
+  console.log("new")
 }
```

**Key points:**
- Context line ` function hello() {` starts with a space
- Deleted line `-  console.log("old")` starts with minus
- Added line `+  console.log("new")` starts with plus
- Closing brace ` }` is context, starts with space

### Example 2: Create New File

```
diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,3 @@
+export function test() {
+  return 42
+}
```

**Key points:**
- `new file mode 100644` indicates file creation
- `--- /dev/null` indicates no old file
- All lines are additions (start with `+`)
- Line count `@@ -0,0 +1,3 @@` means 0 old lines, 3 new lines

### Example 3: Multiple Files in One Patch

```
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
```

**Key points:**
- Each file starts with its own `diff --git` header
- No blank lines between file sections
- Each file is processed independently

### Example 4: Delete File

```
diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function old() {
-  return 1
-}
```

**Key points:**
- `deleted file mode 100644` indicates deletion
- `+++ /dev/null` indicates no new file
- All lines are deletions (start with `-`)

## Common Mistakes

### ❌ Missing diff --git header

```
--- a/test.ts
+++ b/test.ts
@@ -1 +1 @@
-old
+new
```

**Error:** "No file diffs found in patch"
**Fix:** Add `diff --git a/test.ts b/test.ts` at the top

### ❌ Missing space prefix on context lines

```
diff --git a/test.ts b/test.ts
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,3 @@
function hello() {
-  console.log("old")
+  console.log("new")
}
```

**Error:** Parser treats unprefixed lines as non-hunk content
**Fix:** Add space before context lines: ` function hello() {`

### ❌ Incorrect line counts in hunk header

```
diff --git a/test.ts b/test.ts
--- a/test.ts
+++ b/test.ts
@@ -1,5 +1,5 @@
 function hello() {
-  console.log("old")
+  console.log("new")
 }
```

**Error:** May cause context mismatch
**Fix:** Count accurately: 3 lines total, so `@@ -1,3 +1,3 @@`

## Best Practices

1. **Always use dryRun first:**
   ```javascript
   { patch: "...", dryRun: true }
   ```
   This validates the patch and shows preview without modifying files.

2. **Include context lines:**
   - Add 2-3 lines before and after changes
   - Helps ensure patch applies to correct location
   - Prevents accidental matches elsewhere in file

3. **Test with simple patches first:**
   - Start with single-line changes
   - Verify format works before complex multi-file patches

4. **Check line endings:**
   - Tool handles both `\n` and `\r\n`
   - Be consistent within each file

## Tool Parameters

```typescript
{
  patch: string,      // Required: The patch content
  strip?: number,     // Optional: Strip N path components (default: 0)
  dryRun?: boolean    // Optional: Preview only, don't modify (default: false)
}
```

### strip parameter

Use when patch paths don't match workspace structure:

```
# Patch has: a/src/file.ts
# Workspace has: file.ts
# Use: strip: 2  (removes "a/" and "src/")
```

## Return Value

Success:
```javascript
{
  ok: true,
  applied: 2,  // Number of files changed
  results: [
    { path: "file1.ts", changed: true },
    { path: "file2.ts", changed: true }
  ],
  dryRun: false,
  fileEditsPreview: [
    {
      path: "file1.ts",
      before: "...",
      after: "...",
      sizeBefore: 100,
      sizeAfter: 105
    }
  ]
}
```

Error:
```javascript
{
  ok: false,
  error: "No file diffs found in patch"
}
```

## Debugging Tips

1. **"No file diffs found"** → Missing `diff --git` header
2. **"context mismatch"** → Context lines don't match file content
3. **"delete mismatch"** → Deleted lines don't match file content
4. **Empty result** → Check that paths are relative to workspace root

## Complete Working Example

Here's a complete, tested example that modifies an existing file:

```javascript
const patch = `diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,5 +1,5 @@
 export function greet(name: string) {
-  return \`Hello, \${name}!\`
+  return \`Hi, \${name}!\`
 }
 
 export default greet
`

const result = await apply_patch({ patch, dryRun: true })
// Check result.ok and result.fileEditsPreview
// If good, run again with dryRun: false
```

This format is guaranteed to work with the tool.

