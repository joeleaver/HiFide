# Testing Quick Start Guide

## 🚀 Get Started in 5 Minutes

### 1. Run Existing Tests (No Setup Required)

```bash
# Run all tests using saved fixtures (no API keys needed)
pnpm test

# Run in watch mode for development
pnpm test:watch
```

✅ **This works immediately** - uses pre-recorded API responses

### 2. Create Your First Test

Create a new test file: `electron/ipc/flows-v2/nodes/__tests__/myNode.test.ts`

```typescript
import { myNode } from '../myNode'
import { createTestContext, createTestConfig } from '../../../__tests__/utils/testHelpers'

describe('My Node', () => {
  it('should work correctly', async () => {
    const context = createTestContext()
    const config = createTestConfig()
    
    const result = await myNode(context, 'test input', {}, config)
    
    expect(result.status).toBe('success')
    expect(result.data).toBeDefined()
  })
})
```

Run it:
```bash
pnpm test myNode.test.ts
```

### 3. Test with Real APIs (Optional)

**Set up API keys:**

Create `.env.test` file in the root directory:
```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
```

**Record real API responses:**
```bash
# Install dotenv-cli
pnpm add -D dotenv-cli

# Run tests with real APIs and save responses
dotenv -e .env.test pnpm test:record
```

Now your tests will use the recorded responses automatically!

## 📚 Common Test Patterns

### Testing a Chat Node

```typescript
import { withFixture } from '../../../__tests__/utils/fixtures'
import { chatNode } from '../chat'
import { createTestContext, createTestConfig } from '../../../__tests__/utils/testHelpers'

it('should chat with Anthropic', async () => {
  const context = createTestContext({
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022'
  })
  
  const result = await withFixture('my-test', async () => {
    return await chatNode(context, 'Hello!', {}, createTestConfig())
  })
  
  expect(result.status).toBe('success')
  expect(result.data).toBeTruthy()
})
```

### Testing with Tools

```typescript
import { createTestTool } from '../../../__tests__/utils/testHelpers'

it('should use tools', async () => {
  const tools = [createTestTool('calculator')]
  const context = createTestContext()
  
  const result = await chatNode(context, 'Calculate 2+2', { tools }, createTestConfig())
  
  expect(result.status).toBe('success')
})
```

### Testing Error Cases

```typescript
it('should handle errors gracefully', async () => {
  const context = createTestContext()
  
  const result = await myNode(context, '', {}, createTestConfig())
  
  expect(result.status).toBe('error')
  expect(result.error).toBeDefined()
})
```

## 🎯 Test Modes Cheat Sheet

| Mode | Command | Use Case | Needs API Keys? |
|------|---------|----------|-----------------|
| **Replay** | `pnpm test` | Development, CI/CD | ❌ No |
| **Record** | `pnpm test:record` | Create/update fixtures | ✅ Yes |
| **Live** | `pnpm test:live` | Validate fixtures | ✅ Yes |

## 🔧 Useful Commands

```bash
# Run specific test file
pnpm test chat.test.ts

# Run specific test by name
pnpm test -t "should handle simple chat"

# Run with coverage report
pnpm test:coverage

# Update snapshots
pnpm test -u

# Enable debug logging
DEBUG=1 pnpm test

# Run only changed tests (watch mode)
pnpm test:watch
```

## 📁 Project Structure

```
electron/
├── __tests__/
│   ├── setup.ts              # Test configuration
│   ├── utils/
│   │   ├── fixtures.ts       # Record/replay system
│   │   └── testHelpers.ts    # Test utilities
│   ├── fixtures/             # Saved API responses
│   │   └── *.json
│   └── README.md             # Detailed testing guide
│
└── ipc/flows-v2/nodes/
    ├── chat.ts
    ├── tools.ts
    └── __tests__/
        ├── chat.test.ts      # Chat node tests
        └── tools.test.ts     # Tools node tests
```

## 🎓 Learn More

- **Detailed Guide**: See `electron/__tests__/README.md`
- **Architecture**: See `docs/testing-infrastructure.md`
- **Examples**: Look at existing tests in `electron/ipc/flows-v2/nodes/__tests__/`

## 💡 Tips

1. **Start with replay mode** - No setup needed, tests run fast
2. **Use descriptive fixture names** - Makes it easy to find and update them
3. **Test one thing per test** - Easier to debug when tests fail
4. **Commit fixtures to git** - They document expected behavior
5. **Re-record periodically** - Keep fixtures up to date with API changes

## 🐛 Troubleshooting

### "Fixture not found" error
```bash
# Create the fixture by running in record mode
pnpm test:record
```

### "Missing API key" error
```bash
# Either set environment variables or run in replay mode
pnpm test  # Uses fixtures, no API key needed
```

### Tests timing out
```typescript
// Increase timeout for specific test
it('slow test', async () => {
  // ...
}, 60000) // 60 seconds
```

### Want to see console logs
```bash
DEBUG=1 pnpm test
```

## ✅ You're Ready!

You now have everything you need to:
- ✅ Run existing tests
- ✅ Write new tests
- ✅ Test with real APIs
- ✅ Use fixtures for fast tests

Happy testing! 🎉

