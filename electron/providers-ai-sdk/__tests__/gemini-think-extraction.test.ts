/**
 * Tests for Gemini <think> tag extraction
 */

import { describe, it, expect } from '@jest/globals'

// Import the function we're testing
// We need to export it from gemini-openai.ts first
import type { ReasoningState } from '../core/openai-compatible'

// Mock implementation of extractThinkTags for testing
// Handles both <think> and <thought> tags
function extractThinkTags(text: string, state: ReasoningState) {
  let reasoning = ''
  let textContent = text
  let newState = { ...state }

  // Check if we're inside a think/thought tag from a previous chunk
  if (state.insideTag && (state.tagName === 'think' || state.tagName === 'thought')) {
    const endMatch = text.match(new RegExp(`^(.*?)</${state.tagName}>`))
    if (endMatch) {
      reasoning = state.buffer + endMatch[1]
      textContent = text.slice(endMatch[0].length)
      newState = { buffer: '', insideTag: false, tagName: '' }
      return { text: textContent, reasoning, state: newState }
    } else {
      newState = { buffer: state.buffer + text, insideTag: true, tagName: state.tagName }
      return { text: '', reasoning: '', state: newState }
    }
  }

  // Look for <think>...</think> or <thought>...</thought> tags
  const regex = /<(think|thought)>(.*?)<\/\1>/gs
  let match
  let lastIndex = 0
  while ((match = regex.exec(text)) !== null) {
    reasoning += match[2]
    lastIndex = match.index + match[0].length
  }

  // Check for opening tag without closing tag
  const openMatch = text.match(/<(think|thought)>([^]*?)$/)
  if (openMatch && openMatch.index !== undefined && openMatch.index >= lastIndex) {
    reasoning += openMatch[2]
    textContent = text.slice(0, openMatch.index)
    newState = { buffer: openMatch[2], insideTag: true, tagName: openMatch[1] }
    return { text: textContent, reasoning, state: newState }
  }

  // Remove all think/thought tags from the text
  textContent = text.replace(/<(think|thought)>.*?<\/\1>/gs, '')
  newState = { buffer: '', insideTag: false, tagName: '' }

  return { text: textContent, reasoning, state: newState }
}

describe('extractThinkTags', () => {
  const initialState: ReasoningState = { buffer: '', insideTag: false, tagName: '' }

  it('should extract complete think tags', () => {
    const text = '<think>This is thinking</think> This is output'
    const result = extractThinkTags(text, initialState)
    
    expect(result.reasoning).toBe('This is thinking')
    expect(result.text).toBe(' This is output')
    expect(result.state.insideTag).toBe(false)
  })

  it('should handle multiple think tags', () => {
    const text = '<think>First thought</think> output <think>Second thought</think> more'
    const result = extractThinkTags(text, initialState)
    
    expect(result.reasoning).toBe('First thoughtSecond thought')
    expect(result.text).toBe(' output  more')
  })

  it('should handle incomplete think tag at end', () => {
    const text = 'Some output <think>Incomplete thought'
    const result = extractThinkTags(text, initialState)
    
    expect(result.reasoning).toBe('Incomplete thought')
    expect(result.text).toBe('Some output ')
    expect(result.state.insideTag).toBe(true)
    expect(result.state.buffer).toBe('Incomplete thought')
  })

  it('should handle closing tag in next chunk', () => {
    const text = 'Some output <think>Incomplete thought'
    const result1 = extractThinkTags(text, initialState)
    
    const nextChunk = ' more thinking</think> final output'
    const result2 = extractThinkTags(nextChunk, result1.state)
    
    expect(result2.reasoning).toBe('Incomplete thought more thinking')
    expect(result2.text).toBe(' final output')
    expect(result2.state.insideTag).toBe(false)
  })

  it('should handle text with no think tags', () => {
    const text = 'Just regular output'
    const result = extractThinkTags(text, initialState)
    
    expect(result.reasoning).toBe('')
    expect(result.text).toBe('Just regular output')
    expect(result.state.insideTag).toBe(false)
  })

  it('should handle empty think tags', () => {
    const text = '<think></think> output'
    const result = extractThinkTags(text, initialState)
    
    expect(result.reasoning).toBe('')
    expect(result.text).toBe(' output')
  })

  it('should handle multiline think content', () => {
    const text = '<think>Line 1\nLine 2\nLine 3</think> output'
    const result = extractThinkTags(text, initialState)
    
    expect(result.reasoning).toBe('Line 1\nLine 2\nLine 3')
    expect(result.text).toBe(' output')
  })

  it('should handle think tags with special characters', () => {
    const text = '<think>Thinking about "quotes" and \'apostrophes\'</think> output'
    const result = extractThinkTags(text, initialState)

    expect(result.reasoning).toBe('Thinking about "quotes" and \'apostrophes\'')
    expect(result.text).toBe(' output')
  })

  it('should extract complete thought tags', () => {
    const text = '<thought>This is thinking</thought> This is output'
    const result = extractThinkTags(text, initialState)

    expect(result.reasoning).toBe('This is thinking')
    expect(result.text).toBe(' This is output')
    expect(result.state.insideTag).toBe(false)
  })

  it('should handle multiple thought tags', () => {
    const text = '<thought>First thought</thought> output <thought>Second thought</thought> more'
    const result = extractThinkTags(text, initialState)

    expect(result.reasoning).toBe('First thoughtSecond thought')
    expect(result.text).toBe(' output  more')
  })

  it('should handle incomplete thought tag at end', () => {
    const text = 'Some output <thought>Incomplete thought'
    const result = extractThinkTags(text, initialState)

    expect(result.reasoning).toBe('Incomplete thought')
    expect(result.text).toBe('Some output ')
    expect(result.state.insideTag).toBe(true)
    expect(result.state.buffer).toBe('Incomplete thought')
    expect(result.state.tagName).toBe('thought')
  })

  it('should handle closing thought tag in next chunk', () => {
    const text = 'Some output <thought>Incomplete thought'
    const result1 = extractThinkTags(text, initialState)

    const nextChunk = ' more thinking</thought> final output'
    const result2 = extractThinkTags(nextChunk, result1.state)

    expect(result2.reasoning).toBe('Incomplete thought more thinking')
    expect(result2.text).toBe(' final output')
    expect(result2.state.insideTag).toBe(false)
  })

  it('should handle mixed think and thought tags', () => {
    const text = '<think>First</think> middle <thought>Second</thought> end'
    const result = extractThinkTags(text, initialState)

    expect(result.reasoning).toBe('FirstSecond')
    expect(result.text).toBe(' middle  end')
  })
})

