/**
 * OpenAI provider using the OpenAI-compatible core.
 *
 * Uses the native OpenAI SDK directly instead of Vercel AI SDK.
 * This provides better control over streaming, tool calling, and reasoning.
 *
 * Key features:
 * - Full OpenAI Chat Completions API
 * - Supports streaming, function calling, and structured outputs
 * - Supports reasoning effort for o1/o3 models
 *
 * Reference: https://platform.openai.com/docs/api-reference
 */
import {
  createOpenAICompatibleProvider,
} from './core/openai-compatible'
import { supportsReasoningEffort } from '../../shared/model-capabilities'

/**
 * OpenAI provider adapter using the OpenAI-compatible core.
 *
 * Uses the OpenAI API at https://api.openai.com/v1
 */
export const OpenAIOpenAIProvider = createOpenAICompatibleProvider({
  id: 'openai',
  baseURL: 'https://api.openai.com/v1',

  // Configure OpenAI-specific request parameters
  requestModifier: (body, context) => {
    const modified: any = { ...body }
    
    // Add reasoning_effort for o1/o3 models
    if (supportsReasoningEffort(context.model) && context.reasoningEffort) {
      modified.reasoning_effort = context.reasoningEffort
    }
    
    return modified
  }
})

export default OpenAIOpenAIProvider

