
import { GeminiAiSdkProvider } from '../../providers-ai-sdk/gemini'
import { AnthropicAiSdkProvider } from '../../providers-ai-sdk/anthropic'

// Mock the 'ai' module
jest.mock('ai', () => ({
    streamText: jest.fn(),
    tool: jest.fn(),
    stepCountIs: jest.fn(),
    jsonSchema: jest.fn()
}))

import { streamText } from 'ai'


import { GeminiAiSdkProvider } from '../../providers-ai-sdk/gemini'
import { AnthropicAiSdkProvider } from '../../providers-ai-sdk/anthropic'

// Mock the 'ai' module
jest.mock('ai', () => ({
    streamText: jest.fn(),
    tool: jest.fn(),
    stepCountIs: jest.fn(),
    jsonSchema: jest.fn()
}))

import { streamText } from 'ai'


import { GeminiAiSdkProvider } from '../../providers-ai-sdk/gemini'
import { AnthropicAiSdkProvider } from '../../providers-ai-sdk/anthropic'

// Mock the 'ai' module
jest.mock('ai', () => ({
    streamText: jest.fn(),
    tool: jest.fn(),
    stepCountIs: jest.fn(),
    jsonSchema: jest.fn()
}))

import { streamText } from 'ai'


import { GeminiAiSdkProvider } from '../../providers-ai-sdk/gemini'
import { AnthropicAiSdkProvider } from '../../providers-ai-sdk/anthropic'

// Mock the 'ai' module
jest.mock('ai', () => ({
    streamText: jest.fn(),
    tool: jest.fn(),
    stepCountIs: jest.fn(),
    jsonSchema: jest.fn()
}))

import { streamText } from 'ai'

describe('Usage Reporting Refactor', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    describe('Gemini Provider', () => {
        it('should extract reasoning and cached tokens from usage', async () => {
            let capturedUsage: any = null
            const mockOnTokenUsage = (u: any) => { capturedUsage = u }

                // Setup the mock to call onStepFinish
                ; (streamText as jest.Mock).mockImplementation((options: any) => {
                    // Simulate a step finish with usage
                    if (options.onStepFinish) {
                        options.onStepFinish({
                            usage: {
                                inputTokens: 10,
                                outputTokens: 20,
                                totalTokens: 30,
                                reasoningTokens: 5,
                                cachedContentTokenCount: 100 // Gemini specific
                            }
                        })
                    }
                    return {
                        consumeStream: async () => { },
                        cancel: () => { }
                    }
                })

            await GeminiAiSdkProvider.agentStream({
                apiKey: 'test-key',
                model: 'gemini-2.0-flash-thinking',
                messages: [],
                onTokenUsage: mockOnTokenUsage,
                emit: () => { },
                onChunk: () => { },
                onDone: () => { },
                onError: () => { }
            } as any)

            expect(capturedUsage).toBeDefined()
            expect(capturedUsage.reasoningTokens).toBe(5)
            expect(capturedUsage.outputTokens).toBe(20)
            expect(capturedUsage.cachedTokens).toBe(100)
        })
    })

    describe('Anthropic Provider', () => {
        it('should extract reasoning and cached tokens from usage', async () => {
            let capturedUsage: any = null
            const mockOnTokenUsage = (u: any) => { capturedUsage = u }

                // Setup the mock to call onStepFinish
                ; (streamText as jest.Mock).mockImplementation((options: any) => {
                    // Simulate a step finish with usage
                    if (options.onStepFinish) {
                        options.onStepFinish({
                            usage: {
                                inputTokens: 10,
                                outputTokens: 25,
                                totalTokens: 35,
                                reasoningTokens: 8,
                                cacheReadInputTokens: 50 // Anthropic specific
                            }
                        })
                    }
                    return {
                        consumeStream: async () => { },
                        cancel: () => { }
                    }
                })

            await AnthropicAiSdkProvider.agentStream({
                apiKey: 'test-key',
                model: 'claude-3-7-sonnet',
                messages: [],
                onTokenUsage: mockOnTokenUsage,
                emit: () => { },
                onChunk: () => { },
                onDone: () => { },
                onError: () => { }
            } as any)

            expect(capturedUsage).toBeDefined()
            expect(capturedUsage.reasoningTokens).toBe(8)
            expect(capturedUsage.outputTokens).toBe(25)
            expect(capturedUsage.cachedTokens).toBe(50)
        })
    })
})
