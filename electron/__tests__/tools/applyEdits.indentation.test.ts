import { applyEditsPayload } from '../../tools/edits/applySmartEngine'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

describe('applyEdits indentation handling', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'apply-edits-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('should apply a patch even if the search block has different indentation', async () => {
    const filePath = path.join(tempDir, 'test.ts')
    const content = `
function outer() {
    if (true) {
        console.log("hello");
    }
}
`
    await fs.writeFile(filePath, content)

    // The search block has 2 spaces instead of 4
    // We use a relative path here to avoid the RangeError in the test environment
    const relPath = path.basename(filePath)
    const payload = `
File: ${relPath}
<<<<<<< SEARCH
  if (true) {
    console.log("hello");
  }
=======
  if (true) {
    console.log("world");
  }
>>>>>>> REPLACE
`
    const result = await applyEditsPayload(payload, tempDir)
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)

    const newContent = await fs.readFile(filePath, 'utf-8')
    // We want it to preserve the 4-space indentation of the original file
    expect(newContent).toContain('    if (true) {')
    expect(newContent).toContain('        console.log("world");')
  })
})
