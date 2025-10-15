# HiFide Testing Guide

This directory contains the testing infrastructure for HiFide, including unit tests, integration tests, and utilities for testing with real LLM providers.

## Quick Start

```bash
# Run all tests (uses saved fixtures - fast, no API calls)
pnpm test

# Run tests in watch mode (for development)
pnpm test:watch

# Run tests with coverage report
pnpm test:coverage
```

## Test Modes

The testing system supports three modes controlled by the `TEST_MODE` environment variable:

### 1. **Replay Mode** (Default)
Uses saved fixture files for predictable, fast tests without API calls.

```bash
pnpm test
# or explicitly
TEST_MODE=replay pnpm test
```

**When to use:**
- Regular development
- CI/CD pipelines
- When you don't have API keys
- When you want fast, deterministic tests

### 2. **Record Mode**
Makes real API calls and saves responses to fixture files.

```bash
pnpm test:record
# or
TEST_MODE=record pnpm test
```

**When to use:**
- Creating new tests
- Updating fixtures after API changes
- Verifying provider behavior changes

**Requirements:**
- Set API keys as environment variables:
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
  - `GEMINI_API_KEY`

### 3. **Live Mode**
Always makes real API calls, never uses or creates fixtures.

```bash
pnpm test:live
# or
TEST_MODE=live pnpm test
```

**When to use:**
- Validating that fixtures are still accurate
- Testing against latest provider APIs
- Debugging provider-specific issues

## Setting Up API Keys

For record and live modes, you need to set API keys:

### Windows (PowerShell)
```powershell
$env:ANTHROPIC_API_KEY="your-key-here"
$env:OPENAI_API_KEY="your-key-here"
$env:GEMINI_API_KEY="your-key-here"
pnpm test:record
```

### Linux/Mac (Bash)
```bash
export ANTHROPIC_API_KEY="your-key-here"
export OPENAI_API_KEY="your-key-here"
export GEMINI_API_KEY="your-key-here"
pnpm test:record
```

### Using .env file (recommended)
Create a `.env.test` file in the root directory:

```env
ANTHROPIC_API_KEY=your-key-here
OPENAI_API_KEY=your-key-here
GEMINI_API_KEY=your-key-here
```

Then load it before running tests:
```bash
# Install dotenv-cli if needed
pnpm add -D dotenv-cli

# Run tests with .env.test
dotenv -e .env.test pnpm test:record
```

## Writing Tests

### Basic Node Test

```typescript
import { myNode } from '../myNode'
import { createTestContext, createTestConfig } from '../../../../__tests__/utils/testHelpers'

describe('My Node', () => {
  it('should process input correctly', async () => {
    const context = createTestContext()
    const config = createTestConfig()
    
    const result = await myNode(context, 'test input', {}, config)
    
    expect(result.status).toBe('success')
    expect(result.data).toBeDefined()
  })
})
```

### Test with Real API (Record/Replay)

```typescript
import { withFixture } from '../../../../__tests__/utils/fixtures'

it('should handle chat with Anthropic', async () => {
  const context = createTestContext({
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022'
  })
  
  const result = await withFixture(
    'my-test-fixture-name',
    async () => {
      return await chatNode(context, 'Hello!', {}, config)
    }
  )
  
  expect(result.status).toBe('success')
  expect(result.data).toBeDefined()
})
```

### Test with Mock Provider

```typescript
import { createMockProvider } from '../../../../__tests__/utils/testHelpers'

it('should handle streaming', async () => {
  const mockProvider = createMockProvider(['Mock response'])
  
  // Use mockProvider in your test
  // ...
})
```

## Test Utilities

### `createTestContext(overrides?)`
Creates a test execution context with sensible defaults.

```typescript
const context = createTestContext({
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  systemInstructions: 'Custom instructions'
})
```

### `createTestConfig(overrides?)`
Creates a test node configuration.

```typescript
const config = createTestConfig({
  customOption: 'value'
})
```

### `createTestTool(name?)`
Creates a simple test tool for testing tool-calling.

```typescript
const tool = createTestTool('my_tool')
```

### `withFixture(name, fn)`
Wraps an async function to support record/replay.

```typescript
const result = await withFixture('fixture-name', async () => {
  // Make real API call here
  return await someApiCall()
})
```

### `getTestApiKey(provider)`
Gets API key for testing, with helpful error messages.

```typescript
const apiKey = getTestApiKey('anthropic')
```

## Fixture Management

Fixtures are stored in `electron/__tests__/fixtures/` as JSON files.

### Viewing Fixtures
```bash
ls electron/__tests__/fixtures/
```

### Deleting a Fixture (to force re-recording)
```bash
rm electron/__tests__/fixtures/my-fixture.json
pnpm test:record
```

### Fixture Format
```json
{
  "status": "success",
  "data": "Response from LLM",
  "context": {
    "messageHistory": [...]
  }
}
```

## Best Practices

1. **Use descriptive fixture names**: `chat-anthropic-simple`, `chat-openai-with-tools`
2. **Keep fixtures small**: Test one thing per fixture
3. **Commit fixtures to git**: They serve as documentation and regression tests
4. **Re-record periodically**: Ensure fixtures stay current with provider APIs
5. **Test error cases**: Don't just test happy paths
6. **Use replay mode for CI**: Fast, deterministic, no API costs

## Debugging Tests

### Enable console logs
```bash
DEBUG=1 pnpm test
```

### Run a specific test file
```bash
pnpm test chat.test.ts
```

### Run a specific test
```bash
pnpm test -t "should handle simple chat"
```

### Update snapshots
```bash
pnpm test -u
```

## CI/CD Integration

For GitHub Actions or other CI systems:

```yaml
- name: Run tests
  run: pnpm test
  env:
    TEST_MODE: replay  # Use fixtures, no API calls needed
```

For nightly validation with real APIs:

```yaml
- name: Run live tests
  run: pnpm test:live
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

## Troubleshooting

### "Fixture not found" error
Run tests in record mode to create the fixture:
```bash
pnpm test:record
```

### "Missing API key" error
Set the required API key environment variable or run in replay mode.

### Tests timing out
Increase timeout in jest.config.js or for specific tests:
```typescript
it('long running test', async () => {
  // ...
}, 60000) // 60 second timeout
```

