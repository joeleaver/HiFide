# Testing Infrastructure

## Overview

HiFide now has a comprehensive testing infrastructure that supports testing flow nodes and LLM integrations with real API calls while maintaining fast, deterministic tests for development.

## Key Features

### 1. **Record/Replay Pattern**
- **Record Mode**: Make real API calls and save responses to fixtures
- **Replay Mode**: Use saved fixtures for fast, deterministic tests (default)
- **Live Mode**: Always make real API calls for validation

### 2. **Multi-Provider Support**
Tests work with all three providers:
- Anthropic (Claude)
- OpenAI (GPT)
- Gemini

### 3. **Test Utilities**
Comprehensive helpers for:
- Creating test contexts and configs
- Mocking providers
- Creating test tools
- Managing fixtures

## Architecture

```
electron/__tests__/
├── setup.ts                    # Jest setup, runs before all tests
├── utils/
│   ├── fixtures.ts            # Fixture recording/replay system
│   └── testHelpers.ts         # Test utilities (contexts, configs, mocks)
├── fixtures/                  # Saved API responses (gitignored by default)
│   ├── chat-anthropic-simple.json
│   ├── chat-openai-simple.json
│   └── ...
└── README.md                  # Testing guide

electron/ipc/flows-v2/nodes/__tests__/
├── chat.test.ts              # Chat node tests
├── tools.test.ts             # Tools node tests
└── ...                       # More node tests

electron/__mocks__/
└── electron.ts               # Mock Electron APIs for testing
```

## Test Modes

### Replay Mode (Default)
```bash
pnpm test
```
- Uses saved fixtures
- Fast (no API calls)
- Deterministic
- No API keys needed
- Perfect for CI/CD

### Record Mode
```bash
pnpm test:record
```
- Makes real API calls
- Saves responses to fixtures
- Requires API keys
- Use when creating new tests or updating fixtures

### Live Mode
```bash
pnpm test:live
```
- Always makes real API calls
- Never uses or creates fixtures
- Requires API keys
- Use for validating fixtures are still accurate

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
import { chatNode } from '../chat'
import { createTestContext, createTestConfig } from '../../../../__tests__/utils/testHelpers'

describe('Chat Node', () => {
  it('should handle chat with Anthropic', async () => {
    const context = createTestContext({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022'
    })
    const config = createTestConfig()

    const result = await withFixture(
      'chat-anthropic-simple',
      async () => {
        return await chatNode(context, 'Hello!', {}, config)
      }
    )

    expect(result.status).toBe('success')
    expect(result.data).toBeDefined()
  })
})
```

### Test with Tools

```typescript
import { createTestTool } from '../../../../__tests__/utils/testHelpers'

it('should handle chat with tools', async () => {
  const tools = [createTestTool('get_weather')]
  const context = createTestContext()
  const config = createTestConfig()

  const result = await withFixture(
    'chat-with-tools',
    async () => {
      return await chatNode(context, 'What is the weather?', { tools }, config)
    }
  )

  expect(result.status).toBe('success')
})
```

## Test Utilities Reference

### `createTestContext(overrides?)`
Creates a test execution context with sensible defaults.

```typescript
const context = createTestContext({
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  systemInstructions: 'You are a helpful assistant.',
  messageHistory: []
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
// Returns an AgentTool with name, description, parameters, and run function
```

### `withFixture(name, fn)`
Wraps an async function to support record/replay.

```typescript
const result = await withFixture('fixture-name', async () => {
  // This code runs in record/live mode
  // In replay mode, the saved result is returned
  return await someApiCall()
})
```

### `getTestApiKey(provider)`
Gets API key for testing with helpful error messages.

```typescript
const apiKey = getTestApiKey('anthropic')
```

### `createMockProvider(responses?)`
Creates a mock provider for testing without API calls.

```typescript
const mockProvider = createMockProvider(['Response 1', 'Response 2'])
```

## Setting Up API Keys

### Option 1: Environment Variables

**Windows (PowerShell):**
```powershell
$env:ANTHROPIC_API_KEY="your-key-here"
$env:OPENAI_API_KEY="your-key-here"
$env:GEMINI_API_KEY="your-key-here"
pnpm test:record
```

**Linux/Mac (Bash):**
```bash
export ANTHROPIC_API_KEY="your-key-here"
export OPENAI_API_KEY="your-key-here"
export GEMINI_API_KEY="your-key-here"
pnpm test:record
```

### Option 2: .env.test File (Recommended)

Create `.env.test` in the root directory:
```env
ANTHROPIC_API_KEY=your-key-here
OPENAI_API_KEY=your-key-here
GEMINI_API_KEY=your-key-here
```

Then use with dotenv-cli:
```bash
pnpm add -D dotenv-cli
dotenv -e .env.test pnpm test:record
```

## Fixture Management

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
Fixtures are JSON files containing the exact return value from the tested function:

```json
{
  "status": "success",
  "data": "Hello! How can I assist you today?",
  "context": {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022",
    "messageHistory": [
      { "role": "user", "content": "Hello!" },
      { "role": "assistant", "content": "Hello! How can I assist you today?" }
    ]
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
7. **Test all providers**: Ensure consistent behavior across Anthropic, OpenAI, and Gemini

## Running Tests

```bash
# Run all tests (replay mode)
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

# Run specific test file
pnpm test chat.test.ts

# Run specific test
pnpm test -t "should handle simple chat"

# Record new fixtures
pnpm test:record

# Validate with live API calls
pnpm test:live

# Enable debug logging
DEBUG=1 pnpm test
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'pnpm'
      
      - name: Install dependencies
        run: pnpm install
      
      - name: Run tests
        run: pnpm test
        env:
          TEST_MODE: replay  # Use fixtures, no API calls
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

### Nightly Validation with Real APIs

```yaml
name: Nightly API Validation

on:
  schedule:
    - cron: '0 0 * * *'  # Run daily at midnight

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
      
      - name: Install dependencies
        run: pnpm install
      
      - name: Run live tests
        run: pnpm test:live
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

## Next Steps

1. **Add more node tests**: Create tests for all flow nodes
2. **Add integration tests**: Test complete flows end-to-end
3. **Add provider tests**: Test provider adapters directly
4. **Set up CI/CD**: Automate testing on every commit
5. **Monitor coverage**: Track test coverage over time

